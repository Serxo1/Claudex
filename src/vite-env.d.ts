/// <reference types="vite/client" />

declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string;
      allowpopups?: boolean | string;
      nodeintegration?: boolean | string;
      webpreferences?: string;
      preload?: string;
      partition?: string;
    };
  }
}
