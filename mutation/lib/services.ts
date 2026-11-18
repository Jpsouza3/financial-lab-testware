import { Service } from "./catalog";

export const API_SERVICES = ["account", "transfer", "antifraud"] as const;
export type ApiService = (typeof API_SERVICES)[number];

/** Serviço dono de um arquivo do SUT (Contracts é do account). */
export function serviceOfFile(file: string): Service {
    if (file.startsWith("financial-lab-account.")) return "account";
    if (file.startsWith("financial-lab-transfer.")) return "transfer";
    if (file.startsWith("financial-lab-antifraud.")) return "antifraud";
    return "docs";
}

/** Imagens que precisam ser reconstruídas para os arquivos alterados. */
export function imagesFor(files: string[]): ApiService[] {
    const images = new Set<ApiService>();
    for (const file of files) {
        if (file.startsWith("financial-lab-account.Contracts/")) images.add("account").add("transfer");
        else if (file.startsWith("financial-lab-account.")) images.add("account");
        else if (file.startsWith("financial-lab-transfer.")) images.add("transfer");
        else if (file.startsWith("financial-lab-antifraud.")) images.add("antifraud");
        else if (/^(Dockerfile|global\.json|financial-lab-account\.sln|docker-compose\.yml)$/.test(file))
            API_SERVICES.forEach((s) => images.add(s));
    }
    return API_SERVICES.filter((s) => images.has(s));
}

export function changedServices(files: string[]): ApiService[] {
    const services = new Set(files.map(serviceOfFile));
    return API_SERVICES.filter((s) => services.has(s));
}
