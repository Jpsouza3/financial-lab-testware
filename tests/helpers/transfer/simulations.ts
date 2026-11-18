import { ContractValidator } from "../../../core/schema/ContractValidator";
import { GetSimulationResponse } from "../../../domains/transfer/GetSimulationResponse";
import { GetSimulationResponseSchema } from "../../../domains/transfer/GetSimulationResponseSchema";
import { GetTransfersResponseSchema } from "../../../domains/transfer/GetTransfersResponseSchema";
import { PostSimulationBody } from "../../../domains/transfer/PostSimulationBody";
import { PostSimulationResponseSchema } from "../../../domains/transfer/PostSimulationResponseSchema";
import { TransferResponse } from "../../../domains/transfer/TransferResponse";
import { expect } from "../../../fixtures/ApiFixtures";
import { AccountInterface } from "../../../interfaces/AccountInterface";
import { TransferInterface } from "../../../interfaces/TransferInterface";
import { cents, getBalance } from "../account/holds";

export const SIMULATION_DETAIL = {
    transfers: "A quantidade de transferências deve estar entre 1 e 1000.",
    range: "O intervalo de valores deve ter mínimo >= 0,01 e máximo >= mínimo.",
    accounts: "A simulação precisa de pelo menos duas contas.",
} as const;

export function buildSimulationBody(accountIds: string[], overrides: Partial<PostSimulationBody> = {}): PostSimulationBody {
    return { transfers: 3, minAmount: 0.01, maxAmount: 1.0, accountIds, ...overrides };
}

/** Corpo propositalmente inválido (campo ausente) para os casos de validação. */
export function invalidSimulationBody(body: Record<string, unknown>): PostSimulationBody {
    return body as unknown as PostSimulationBody;
}

/** Inicia a simulação e afirma 202 + Location + contrato; devolve o simulationId. */
export async function startSimulation(transferService: TransferInterface, body: PostSimulationBody): Promise<string> {
    const res = await transferService.PostSimulation(body);
    expect(res.status, res.text).toBe(202);
    ContractValidator.validate(PostSimulationResponseSchema, res.body);
    expect(res.headers["location"]).toMatch(new RegExp(`/simulations/${res.body.simulationId}$`, "i"));
    return res.body.simulationId;
}

export async function getSimulation(transferService: TransferInterface, simulationId: string): Promise<GetSimulationResponse> {
    const res = await transferService.GetSimulation(simulationId);
    expect(res.status, `GET /simulations/${simulationId}: ${res.text}`).toBe(200);
    ContractValidator.validate(GetSimulationResponseSchema, res.body);
    return res.body;
}

/** total e soma de byStatus iguais a `transfers`. */
export function expectSummaryTotals(summary: GetSimulationResponse, simulationId: string, transfers: number): void {
    expect(summary.simulationId).toBe(simulationId);
    expect(summary.total).toBe(transfers);
    expect(Object.values(summary.byStatus).reduce((a, b) => a + (b ?? 0), 0)).toBe(transfers);
}

export async function waitForSimulationFinished(
    transferService: TransferInterface,
    simulationId: string,
    timeout = 60_000
): Promise<GetSimulationResponse> {
    let last: GetSimulationResponse | undefined;
    await expect
        .poll(
            async () => {
                last = await getSimulation(transferService, simulationId);
                return last.finished;
            },
            { message: `simulação ${simulationId} deveria terminar`, timeout, intervals: [500, 1_000] }
        )
        .toBe(true);
    return last!;
}

/** Transferências da simulação (`take` 500 cobre qualquer simulação dos testes). */
export async function listSimulationTransfers(transferService: TransferInterface, simulationId: string): Promise<TransferResponse[]> {
    const res = await transferService.GetTransfers({ simulationId, take: 500 });
    expect(res.status, res.text).toBe(200);
    ContractValidator.validate(GetTransfersResponseSchema, res.body);
    return res.body;
}

export async function sumBalances(accountService: AccountInterface, accountIds: string[]): Promise<number> {
    const balances = await Promise.all(accountIds.map((id) => getBalance(accountService, id)));
    return cents(balances.reduce((acc, b) => acc + b.balance, 0));
}

/** Cada transferência da simulação segue a regra de geração da spec. */
export function expectGeneratedTransfers(
    transfers: TransferResponse[],
    simulationId: string,
    body: PostSimulationBody
): void {
    expect(transfers).toHaveLength(body.transfers);
    const accountIds = body.accountIds ?? [];
    for (const t of transfers) {
        expect(t.simulationId).toBe(simulationId);
        expect(accountIds).toContain(t.sourceAccountId);
        expect(accountIds).toContain(t.destinationAccountId);
        expect(t.sourceAccountId).not.toBe(t.destinationAccountId);
        expect(t.amount).toBeGreaterThanOrEqual(body.minAmount);
        expect(t.amount).toBeLessThanOrEqual(body.maxAmount);
        expect(cents(t.amount)).toBe(t.amount);
    }
    const expected = Array.from({ length: body.transfers }, (_, i) => `Simulação ${i + 1}/${body.transfers}`);
    expect(transfers.map((t) => t.description).sort()).toEqual(expected.sort());
}
