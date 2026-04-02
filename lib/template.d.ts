// Type declaration for template.js (ESM module)

export {};

declare module '../lib/template.js' {
    export function buildConfigHTML(countries: readonly string[]): string;
}

declare module './template.js' {
    export function buildConfigHTML(countries: readonly string[]): string;
}
