export type Rng = {
    next(): number;
    int(min: number, max: number): number;
    pick<T>(items: readonly T[]): T;
    weighted<T>(items: readonly T[], weight: (item: T) => number): T;
};

export function createRng(seed: number): Rng {
    let state = seed >>> 0;
    const next = (): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
    const weighted = <T>(items: readonly T[], weight: (item: T) => number): T => {
        const total = items.reduce((sum, item) => sum + weight(item), 0);
        let roll = next() * total;
        for (const item of items) {
            roll -= weight(item);
            if (roll < 0) return item;
        }
        return items[items.length - 1];
    };
    return { next, int, pick, weighted };
}
