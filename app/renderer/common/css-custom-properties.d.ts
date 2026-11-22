import 'react';

// Inline styles set CSS custom properties (`--label`, `--navigation-width`) that the stylesheets read.
declare module 'react' {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}
