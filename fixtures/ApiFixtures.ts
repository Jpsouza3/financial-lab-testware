import { test as base, PlaywrightWorkerArgs } from "@playwright/test";
import { config } from "../core/config/EnvironmentConfig";
import { HttpClient } from "../core/http/HttpClient";
import { PlaywrightHttpClient } from "../core/http/PlaywrightHttpClient";
import { AccountInterface } from "../interfaces/AccountInterface";
import { AntifraudInterface } from "../interfaces/AntifraudInterface";
import { TransferInterface } from "../interfaces/TransferInterface";
import { AccountService } from "../services/AccountService";
import { AntifraudService } from "../services/AntifraudService";
import { TransferService } from "../services/TransferService";

/**
 * Composition root: o único lugar que conecta Playwright → adapter → service.
 * Os testes recebem a interface do domínio, nunca o service concreto nem o `APIRequestContext`.
 */
type ApiFixtures = {
    accountService: AccountInterface;
    transferService: TransferInterface;
    antifraudService: AntifraudInterface;
};

/** Fixture de um service: abre um `APIRequestContext` com o baseURL da API e descarta ao fim do teste. */
function serviceFixture<S>(baseURL: string, create: (http: HttpClient) => S) {
    return async ({ playwright }: PlaywrightWorkerArgs, use: (service: S) => Promise<void>) => {
        const context = await playwright.request.newContext({ baseURL });
        try {
            await use(create(new PlaywrightHttpClient(context)));
        } finally {
            await context.dispose();
        }
    };
}

export const test = base.extend<ApiFixtures>({
    accountService: serviceFixture(config.accountApiUrl, (http) => new AccountService(http)),
    transferService: serviceFixture(config.transferApiUrl, (http) => new TransferService(http)),
    antifraudService: serviceFixture(config.antifraudApiUrl, (http) => new AntifraudService(http)),
});

export { expect } from "@playwright/test";
