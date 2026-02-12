## Setup

- Package manager: Yarn. Run all commands using `yarn` (e.g., `yarn tsc`, `yarn tsx script.ts`).
- Install deps: `yarn`

## Required checks

- If JavaScript, TypeScript, or JSON files are modified, run:
  - `yarn tsbuild` for typechecking.
  - Ensure type check passes.
- After any changes, check if `README.md` needs updating (e.g., new files, changed APIs, modified project structure, new CLI options).

## Code style

- TypeScript strict mode
- Use functional patterns where possible
- Prefer `.map()`, `.filter()`, `.flatMap()`, `.reduce()` over `for` loops
- Avoid mutable variables; prefer `const` with transformations
- Use Remeda for cleaner functional programming (e.g., `R.pipe()`, `R.map()`, `R.filter()`, `R.groupBy()`)
- Fail early with explicit errors rather than excessive optional chaining; throw when data should exist
- Prefer declaring functions so helpers used later appear above their call sites.

## LSP

- Use the LSP tool freely when working with TypeScript files for code intelligence (go to definition, find references, hover for type info, document symbols, call hierarchies, etc.)

## React components

Follow this structure for React components:

```tsx
import {FC} from "react";
import tiwi from "tiwi";

//
// Props.
//

interface MyComponentProps {
  // ...
}

//
// Style.
//

const Layout = tiwi.div`
  // Tailwind classes
`;

//
// Component.
//

export const MyComponent: FC<MyComponentProps> = props => {
  // ...
};
```

- Use `tiwi` for styling (Tailwind-in-JS)
- Organize sections in order: Props, Style, Component
- Use comment separators (`// Props.`, `// Style.`, `// Component.`)
- React Compiler is enabled; do not use `useMemo` or `useCallback` as the compiler handles memoization automatically

## Testing

- Test runner: Vitest. Run tests with `yarn test` or `yarn test:watch`.
- Place test files in a `__tests__` folder at the same level as the file being tested.
- Use `.test.ts` suffix for test files.
- Example: Tests for `src/helpers/hash.ts` go in `src/helpers/__tests__/hash.test.ts`.

## Git

- Do not add co-author lines to commit messages.
- NEVER run `git checkout -- <file>` or `git restore <file>` without first running `git diff` on that file and confirming the changes to discard with the user. There may be unrelated working changes that must not be lost.

## Compatibility

- We only target Node 25 or newer. No need for legacy compatibility.
