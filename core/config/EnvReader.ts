/**
 * Leitura tipada de variáveis de ambiente.
 *
 * Os erros são acumulados em vez de lançados na primeira falha, para que `assertValid`
 * mostre de uma vez tudo o que falta ou está inválido no ambiente.
 */
export class EnvReader {
    private readonly problems: string[] = [];

    constructor(private readonly source: NodeJS.ProcessEnv, private readonly origin: string) {}

    /** Texto obrigatório. */
    required(name: string): string {
        const value = this.raw(name);
        if (value === undefined) this.problems.push(`${name}: obrigatória e ausente`);
        return value ?? "";
    }

    /** Texto opcional: ausente ou vazio vira `undefined` (o teste que depende dele faz `test.skip`). */
    optional(name: string): string | undefined {
        return this.raw(name);
    }

    /** URL http(s) obrigatória, sem barra final. */
    url(name: string): string {
        const value = this.required(name);
        if (!value) return value;
        try {
            const parsed = new URL(value);
            if (!/^https?:$/.test(parsed.protocol)) throw new Error();
        } catch {
            this.problems.push(`${name}: URL http(s) inválida`);
        }
        return value.replace(/\/+$/, "");
    }

    /** Lista separada por vírgula; ausente vira `[]`. */
    list(name: string): string[] {
        return (this.raw(name) ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    }

    /** Lança um único erro com todos os problemas encontrados. */
    assertValid(): void {
        if (!this.problems.length) return;
        throw new Error(
            `Configuração de ambiente inválida (${this.origin}):\n` +
            this.problems.map((p) => `  - ${p}`).join("\n") +
            `\nVeja .env.example para a lista de variáveis.`
        );
    }

    private raw(name: string): string | undefined {
        return this.source[name]?.trim() || undefined;
    }
}
