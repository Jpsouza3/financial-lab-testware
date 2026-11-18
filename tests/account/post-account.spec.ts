/**
 * Abrir Conta (v1.0.0) — POST /accounts
 *
 * Regra: 201 abre a conta Active na agência pedida (padrão 0001), com número sequencial por agência (5 dígitos),
 * nome normalizado e balance igual ao initialDeposit. Depósito > 0 gera um único crédito "Depósito inicial" com
 * endToEndId OPEN<branch><number> (version 1); sem depósito, nenhum lançamento (version 0). Validações 400 na ordem
 * R1–R5, R7, R8; agência inexistente 422 (R6); CPF com conta Active ou Blocked 409 (R9). Falha não grava nada.
 *
 * Contas: cada teste usa CPFs aleatórios (tests/helpers/account/accounts.ts).
 * Fora do escopo (v1.0.0): números exatos da agência (outras execuções abrem contas em paralelo) e aberturas
 * simultâneas com o mesmo CPF (a spec não define o resultado).
 */
import { PostAccountBody } from "../../domains/account/PostAccountBody";
import { expect, test } from "../../fixtures/ApiFixtures";
import { AccountInterface } from "../../interfaces/AccountInterface";
import {
    buildAccountBody,
    expectAccountCreated,
    getAccount,
    invalidAccountBody,
    openAccount,
    validCpf,
    validCpfWithRestTen,
    withWrongCheckDigit,
} from "../helpers/account/accounts";
import { getBalance } from "../helpers/account/holds";
import { getStatement } from "../helpers/account/statement";
import { expectProblem } from "../helpers/common/problem";

const DETAIL = {
    nameRequired: "O nome é obrigatório.",
    nameLength: "O nome deve ter entre 3 e 150 caracteres.",
    nameChars: "O nome deve conter apenas letras, espaços, hífen ou apóstrofo.",
    cpf: "CPF inválido.",
    branchFormat: "A agência deve ter 4 dígitos.",
    branchUnknown: "Agência inexistente.",
    depositRange: "O depósito inicial deve estar entre 0 e 5000.00.",
    depositDecimals: "O depósito inicial deve ter no máximo 2 casas decimais.",
    duplicate: "Já existe uma conta não encerrada para este documento.",
} as const;

async function expectNothingRecorded(accountService: AccountInterface, document: string): Promise<void> {
    const res = await accountService.PostAccount(buildAccountBody({ document }));
    expect(res.status, `CPF ${document} deveria continuar livre: ${res.text}`).toBe(201);
}

test.describe("POST /accounts", { tag: ["@account", "@spec:abrir-conta"] }, () => {
    test.describe("abertura", () => {
        test("OPN-01: Abrir conta só com nome e CPF", async ({ accountService }) => {
            const body = buildAccountBody({ name: "Maria Silva" });

            const account = await test.step("abre a conta", async () => {
                const created = expectAccountCreated(await accountService.PostAccount(body), body);
                expect(created.name).toBe("Maria Silva");
                expect(created.number).toMatch(/^\d{5}$/);
                expect(created.balance).toBe(0);
                return created;
            });

            await test.step("GET devolve a mesma conta", async () => {
                expect(await getAccount(accountService, account.accountId)).toEqual(account);
            });

            await test.step("sem depósito: version 0 e extrato vazio", async () => {
                const balance = await getBalance(accountService, account.accountId);
                expect(balance).toMatchObject({ status: "Active", balance: 0, blockedBalance: 0, availableBalance: 0, version: 0 });
                const statement = await getStatement(accountService, account.accountId);
                expect(statement.totalItems).toBe(0);
                expect(statement.items).toEqual([]);
            });
        });

        test("OPN-02: Abrir conta com depósito inicial gera um crédito \"Depósito inicial\"", async ({ accountService }) => {
            const body = buildAccountBody({ initialDeposit: 250.75 });

            const account = expectAccountCreated(await accountService.PostAccount(body), body);

            await test.step("saldo com version 1", async () => {
                const balance = await getBalance(accountService, account.accountId);
                expect(balance.balance).toBeCloseTo(250.75, 2);
                expect(balance.availableBalance).toBeCloseTo(250.75, 2);
                expect(balance.version).toBe(1);
            });

            await test.step("extrato com um único lançamento de crédito", async () => {
                const statement = await getStatement(accountService, account.accountId);
                expect(statement.totalItems).toBe(1);
                expect(statement.items).toHaveLength(1);
                const [entry] = statement.items;
                expect(entry.type).toBe("Credit");
                expect(entry.amount).toBeCloseTo(250.75, 2);
                expect(entry.balanceAfter).toBeCloseTo(250.75, 2);
                expect(entry.description).toBe("Depósito inicial");
                expect(entry.endToEndId).toBe(`OPEN${account.branch}${account.number}`);
            });
        });

        test("OPN-03: Depósito inicial no limite de 5000.00 é aceito", async ({ accountService }) => {
            const body = buildAccountBody({ initialDeposit: 5000.0 });

            const account = expectAccountCreated(await accountService.PostAccount(body), body);

            const balance = await getBalance(accountService, account.accountId);
            expect(balance.balance).toBeCloseTo(5000, 2);
            expect(balance.version).toBe(1);
        });

        test("OPN-04: Depósito inicial 0 explícito não gera lançamento", async ({ accountService }) => {
            const body = buildAccountBody({ initialDeposit: 0 });

            const account = expectAccountCreated(await accountService.PostAccount(body), body);

            expect((await getBalance(accountService, account.accountId)).version).toBe(0);
            expect((await getStatement(accountService, account.accountId)).totalItems).toBe(0);
        });

        test("OPN-05: Nome é normalizado e aceita acentos, hífen e apóstrofo", async ({ accountService }) => {
            const variations = [
                { sent: "   João   da   Silva  ", stored: "João da Silva" },
                { sent: "Ana-Clara D'Ávila", stored: "Ana-Clara D'Ávila" },
                { sent: "Zé\t\tÇão", stored: "Zé Ção" },
            ];
            for (const v of variations) {
                await test.step(JSON.stringify(v.sent), async () => {
                    const body = buildAccountBody({ name: v.sent });
                    const account = expectAccountCreated(await accountService.PostAccount(body), body);
                    expect(account.name).toBe(v.stored);
                    expect((await getAccount(accountService, account.accountId)).name).toBe(v.stored);
                });
            }
        });

        test("OPN-06: Agência 0002 tem numeração própria e sequencial", async ({ accountService }) => {
            const first = await test.step("1ª conta na 0002", async () => {
                const body = buildAccountBody({ branch: "0002" });
                return expectAccountCreated(await accountService.PostAccount(body), body);
            });
            const second = await test.step("2ª conta na 0002", async () => {
                const body = buildAccountBody({ branch: "0002" });
                return expectAccountCreated(await accountService.PostAccount(body), body);
            });

            expect(first.branch).toBe("0002");
            expect(second.number).toMatch(/^\d{5}$/);
            expect(Number(second.number)).toBeGreaterThan(Number(first.number));
        });

        test("OPN-07: Duas aberturas simultâneas na mesma agência recebem números diferentes", async ({ accountService }) => {
            const bodies = Array.from({ length: 2 }, () => buildAccountBody({ branch: "0002" }));

            const responses = await Promise.all(bodies.map((b) => accountService.PostAccount(b)));

            const numbers = responses.map((res, i) => expectAccountCreated(res, bodies[i]).number);
            expect(new Set(numbers).size).toBe(numbers.length);
        });
    });

    test.describe("validação do corpo", () => {
        test("OPN-08: name ausente ou vazio", async ({ accountService }) => {
            const invalid: { label: string; name?: unknown }[] = [
                { label: "ausente" },
                { label: "null", name: null },
                { label: "vazio", name: "" },
                { label: "só espaços", name: "    " },
            ];
            for (const v of invalid) {
                await test.step(`400: ${v.label}`, async () => {
                    const document = validCpf();
                    const body = invalidAccountBody(v.name === undefined ? { document } : { document, name: v.name });
                    expectProblem(await accountService.PostAccount(body), 400, DETAIL.nameRequired);
                    await expectNothingRecorded(accountService, document);
                });
            }
        });

        test("OPN-09: name normalizado fora de 3 a 150 caracteres", async ({ accountService }) => {
            for (const name of ["Jo", "   Jo   ", "a".repeat(151), ` ${"a".repeat(151)} `]) {
                await test.step(`400: ${name.length} caracteres enviados`, async () => {
                    expectProblem(await accountService.PostAccount(buildAccountBody({ name })), 400, DETAIL.nameLength);
                });
            }

            for (const name of ["Ana", "  Ana  ", "a".repeat(150), `  ${"a".repeat(150)}  `]) {
                await test.step(`controle 201: ${name.trim().length} caracteres após normalizar`, async () => {
                    const body = buildAccountBody({ name });
                    const account = expectAccountCreated(await accountService.PostAccount(body), body);
                    expect(account.name).toBe(name.trim());
                });
            }
        });

        test("OPN-10: name com dígito ou símbolo", async ({ accountService }) => {
            for (const name of ["Maria 2", "Maria_Silva", "Maria.Silva", "Maria@Silva", "José!", "Ana & Bia"]) {
                await test.step(`400: ${name}`, async () => {
                    expectProblem(await accountService.PostAccount(buildAccountBody({ name })), 400, DETAIL.nameChars);
                });
            }
        });

        test("OPN-11: document ausente ou fora do formato de 11 dígitos", async ({ accountService }) => {
            const cpf = validCpf();
            const masked = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
            const invalid: { label: string; document?: unknown }[] = [
                { label: "ausente" },
                { label: "vazio", document: "" },
                { label: "com máscara", document: masked },
                { label: "10 dígitos", document: cpf.slice(0, 10) },
                { label: "12 dígitos", document: `${cpf}0` },
                { label: "com letra", document: `${cpf.slice(0, 10)}a` },
                { label: "com espaço", document: ` ${cpf}` },
            ];
            for (const v of invalid) {
                await test.step(`400: ${v.label}`, async () => {
                    const { document: _omit, ...rest } = buildAccountBody();
                    const body = invalidAccountBody(v.document === undefined ? rest : { ...rest, document: v.document });
                    expectProblem(await accountService.PostAccount(body), 400, DETAIL.cpf);
                });
            }
            await expectNothingRecorded(accountService, cpf);
        });

        test("OPN-12: document com dígito verificador inválido", async ({ accountService }) => {
            const cpf = validCpf();
            for (const position of [1, 2] as const) {
                await test.step(`400: ${position}º dígito verificador errado`, async () => {
                    const body = buildAccountBody({ document: withWrongCheckDigit(cpf, position) });
                    expectProblem(await accountService.PostAccount(body), 400, DETAIL.cpf);
                });
            }

            await test.step("controle 201: o mesmo CPF com os dígitos corretos", async () => {
                const body = buildAccountBody({ document: cpf });
                expectAccountCreated(await accountService.PostAccount(body), body);
            });
        });

        test("OPN-13: document com sequência repetida", async ({ accountService }) => {
            for (const digit of ["0", "1", "5", "9"]) {
                await test.step(`400: ${digit.repeat(11)}`, async () => {
                    const body = buildAccountBody({ document: digit.repeat(11) });
                    expectProblem(await accountService.PostAccount(body), 400, DETAIL.cpf);
                });
            }
        });

        test("OPN-14: CPF cujo cálculo do 1º dígito dá resto 10 tem dígito 0", async ({ accountService }) => {
            const cpf = validCpfWithRestTen(1);
            expect(cpf[9]).toBe("0");

            await test.step("400: mesmo CPF com 1º dígito 1", async () => {
                const wrong = `${cpf.slice(0, 9)}1${cpf.slice(10)}`;
                expectProblem(await accountService.PostAccount(buildAccountBody({ document: wrong })), 400, DETAIL.cpf);
            });

            await test.step("201: dígito 0", async () => {
                const body = buildAccountBody({ document: cpf });
                expectAccountCreated(await accountService.PostAccount(body), body);
            });
        });

        test("OPN-15: CPF cujo cálculo do 2º dígito dá resto 10 tem dígito 0", async ({ accountService }) => {
            const cpf = validCpfWithRestTen(2);
            expect(cpf[10]).toBe("0");

            await test.step("400: mesmo CPF com 2º dígito 1", async () => {
                const wrong = `${cpf.slice(0, 10)}1`;
                expectProblem(await accountService.PostAccount(buildAccountBody({ document: wrong })), 400, DETAIL.cpf);
            });

            await test.step("201: dígito 0", async () => {
                const body = buildAccountBody({ document: cpf });
                expectAccountCreated(await accountService.PostAccount(body), body);
            });
        });

        test("OPN-16: branch que não tem 4 dígitos", async ({ accountService }) => {
            for (const branch of ["", "1", "001", "00001", "00a1", "０００１"]) {
                await test.step(`400: ${JSON.stringify(branch)}`, async () => {
                    const document = validCpf();
                    expectProblem(await accountService.PostAccount(buildAccountBody({ document, branch })), 400, DETAIL.branchFormat);
                    await expectNothingRecorded(accountService, document);
                });
            }
        });

        test("OPN-17: branch de 4 dígitos inexistente", async ({ accountService }) => {
            for (const branch of ["0000", "0003", "9999"]) {
                await test.step(`422: ${branch}`, async () => {
                    const document = validCpf();
                    expectProblem(await accountService.PostAccount(buildAccountBody({ document, branch })), 422, DETAIL.branchUnknown);
                    await expectNothingRecorded(accountService, document);
                });
            }
        });

        test("OPN-18: initialDeposit negativo ou acima de 5000.00", async ({ accountService }) => {
            for (const initialDeposit of [-0.01, -100, 5000.01, 10000]) {
                await test.step(`400: ${initialDeposit}`, async () => {
                    const document = validCpf();
                    expectProblem(await accountService.PostAccount(buildAccountBody({ document, initialDeposit })), 400, DETAIL.depositRange);
                    await expectNothingRecorded(accountService, document);
                });
            }
        });

        test("OPN-19: initialDeposit com mais de 2 casas decimais", async ({ accountService }) => {
            for (const initialDeposit of [10.001, 0.005, 4999.999]) {
                await test.step(`400: ${initialDeposit}`, async () => {
                    const body = buildAccountBody({ initialDeposit });
                    expectProblem(await accountService.PostAccount(body), 400, DETAIL.depositDecimals);
                });
            }

            for (const initialDeposit of [0.01, 10.1]) {
                await test.step(`controle 201: ${initialDeposit}`, async () => {
                    const body = buildAccountBody({ initialDeposit });
                    expectAccountCreated(await accountService.PostAccount(body), body);
                });
            }
        });

        test("OPN-20: Ordem de avaliação das validações", async ({ accountService }) => {
            const cases: { label: string; body: Record<string, unknown>; status: number; detail: string }[] = [
                { label: "nome vazio + CPF inválido", body: { name: "", document: "123" }, status: 400, detail: DETAIL.nameRequired },
                { label: "nome curto + caractere inválido", body: { name: "1", document: validCpf() }, status: 400, detail: DETAIL.nameLength },
                { label: "caractere inválido + CPF inválido", body: { name: "Ana 1", document: "123" }, status: 400, detail: DETAIL.nameChars },
                { label: "CPF inválido + agência inválida", body: { name: "Ana", document: "123", branch: "1" }, status: 400, detail: DETAIL.cpf },
                { label: "agência inválida + depósito negativo", body: { name: "Ana", document: validCpf(), branch: "1", initialDeposit: -1 }, status: 400, detail: DETAIL.branchFormat },
                { label: "depósito acima do máximo com 3 casas", body: { name: "Ana", document: validCpf(), initialDeposit: 5000.001 }, status: 400, detail: DETAIL.depositRange },
                { label: "agência inexistente + depósito negativo", body: { name: "Ana", document: validCpf(), branch: "0003", initialDeposit: -1 }, status: 400, detail: DETAIL.depositRange },
                { label: "agência inexistente + 3 casas decimais", body: { name: "Ana", document: validCpf(), branch: "0003", initialDeposit: 1.001 }, status: 400, detail: DETAIL.depositDecimals },
            ];
            for (const c of cases) {
                await test.step(`${c.status}: ${c.label}`, async () => {
                    expectProblem(await accountService.PostAccount(invalidAccountBody(c.body)), c.status, c.detail);
                });
            }
        });
    });

    test.describe("documento já usado", () => {
        test("OPN-21: CPF com conta Active", async ({ accountService }) => {
            const existing = await openAccount(accountService);

            const res = await accountService.PostAccount(buildAccountBody({ document: existing.document, branch: "0002" }));

            expectProblem(res, 409, DETAIL.duplicate);
            expect(await getAccount(accountService, existing.accountId)).toEqual(existing);
        });

        test("OPN-22: CPF com conta Blocked", async ({ accountService }) => {
            const existing = await openAccount(accountService, { status: "Blocked" });

            expectProblem(await accountService.PostAccount(buildAccountBody({ document: existing.document })), 409, DETAIL.duplicate);
        });

        test("OPN-23: CPF só com conta Closed pode abrir outra conta", async ({ accountService }) => {
            const closed = await openAccount(accountService, { initialDeposit: 0, status: "Closed" });
            const body: PostAccountBody = buildAccountBody({ document: closed.document, initialDeposit: 10 });

            const reopened = expectAccountCreated(await accountService.PostAccount(body), body);

            expect(reopened.accountId).not.toBe(closed.accountId);
            expect((await getAccount(accountService, closed.accountId)).status).toBe("Closed");

            await test.step("com a nova conta Active, o CPF volta a dar 409", async () => {
                expectProblem(await accountService.PostAccount(buildAccountBody({ document: closed.document })), 409, DETAIL.duplicate);
            });
        });

        test("OPN-24: Agência inexistente vem antes do CPF duplicado", async ({ accountService }) => {
            const existing = await openAccount(accountService);

            const res = await accountService.PostAccount(buildAccountBody({ document: existing.document, branch: "0003" }));

            expectProblem(res, 422, DETAIL.branchUnknown);
        });
    });
});
