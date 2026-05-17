/// <reference types="vite/client" />

declare module '*.css?inline' {
  const css: string;
  export default css;
}
declare module '*.png' {
  const url: string;
  export default url;
}
