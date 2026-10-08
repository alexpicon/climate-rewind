// @types/react-dom is not installed (no new packages), so declare the one function the render tests use.
declare module "react-dom/server" {
  export function renderToStaticMarkup(element: import("react").ReactElement): string;
}
