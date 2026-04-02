// Type declaration for template.js (kept as CommonJS)
// eslint-disable-next-line @typescript-eslint/no-require-imports
declare const _template: {
    buildConfigHTML(countries: readonly string[]): string;
};
export default _template;
export { _template as __template };

// Also provide ambient module declaration for direct imports
export {};

declare module '../lib/template.js' {
    export function buildConfigHTML(countries: readonly string[]): string;
}

declare module './template.js' {
    export function buildConfigHTML(countries: readonly string[]): string;
}
