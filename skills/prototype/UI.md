# UI prototype

Build several structurally different versions of one screen, all on a single route, and switch between them from a floating bar at the bottom of the page. The user flips through in the browser, picks one (or takes pieces from several), and the rest are discarded.

If the question is about logic or state rather than looks, use `LOGIC.md` instead.

## When this is the right kind

- "What should this page look like?"
- "Show me a few options for this dashboard before we commit."
- "Try a different layout for the settings screen."
- Any case where the user would otherwise spend a day choosing between vague mockups in their head.

## Two placements: prefer A

A design is much easier to judge next to the rest of the app: the real header, sidebar, data and density. A bare throwaway route is a vacuum where every variant looks fine. Use placement A whenever a plausible host page exists, and use B only when none does.

### A. Inside an existing page (preferred)

The route already exists. The variants render on that same route, chosen by a `?variant=` URL parameter. Existing data loading, route params and authentication stay as they are; only the rendered part changes. This also applies to something with no page of its own that would naturally live inside one (a new section of a dashboard, a new card on a settings screen, a new step in an existing flow): mount the variants in the host page.

### B. A new page (last resort)

Use this only when the thing has no sensible home: a new top-level surface, or a flow that cannot be embedded. Create a throwaway route that follows the project's existing routing convention, and do not invent a new top-level structure. Put the word `prototype` in the path or file name. It uses the same `?variant=` parameter.

Before choosing B, check again that no existing page could host it. An empty route hides problems that a populated page would show.

The floating bar is the same in both.

## 1. State the question and pick a count

Default to 3 variants. Past 5 they stop being radically different and turn into noise, so 5 is the cap. Write the plan in one line, in the prototype's folder or at the top of the file:

> Three variants of the settings page, switchable with `?variant=`, on the existing `/settings` route.

This reads the same whether or not the user is around to object.

## 2. Draft radically different variants

Give each variant the same brief:

- the page's purpose and the data it can use;
- the project's own component library and styling system (use what the project already has; do not add one);
- a clear exported component name, such as `VariantA`, `VariantB`, `VariantC`.

Variants must differ in structure: layout, information hierarchy, the main thing the user is invited to do. Different colours do not count. Three slightly altered card grids is wallpaper, not a prototype. If two drafts come out alike, redo one with an explicit ban on the shared pattern (for example "do not use a card grid").

## 3. Wire them together

One switcher on the route. This sketch is pseudo-code; adapt it to the project's framework:

```tsx
const variant = searchParams.get('variant') ?? 'A';
return (
  <>
    {variant === 'A' && <VariantA {...data} />}
    {variant === 'B' && <VariantB {...data} />}
    {variant === 'C' && <VariantC {...data} />}
    <PrototypeSwitcher variants={['A','B','C']} current={variant} />
  </>
);
```

How the parameter reaches the code depends on the framework and its version. In Next.js 15 and later, the page-level `searchParams` prop is a Promise, so the page is an async component and reads it with `await searchParams`; a client component reads it with `useSearchParams()`. Check the project's framework version and its own docs before copying the sketch.

In placement A, keep all the existing data loading above the switcher, so only the rendered part changes per variant. In placement B, the throwaway route (for example `/prototype/<name>`) mounts the same switcher.

## 4. Build the floating switcher

A small fixed bar at the bottom centre of the screen with three parts:

- **Left arrow**: previous variant, wrapping around at the start.
- **Label**: the current variant key, plus its name if the variant exports one, such as `B (Sidebar layout)`.
- **Right arrow**: next variant, wrapping around at the end.

Behaviour:

- A click on an arrow updates the URL parameter through the framework's router (`router.replace` in Next.js, `navigate` in React Router, and so on), so the choice survives a reload and can be shared.
- The left and right arrow keys also cycle, except while an `<input>`, `<textarea>` or `[contenteditable]` element has focus.
- The bar looks clearly different from the page (a high-contrast pill with a light shadow), so nobody mistakes it for part of the design under review.
- The bar is hidden in production builds, so a prototype merged by mistake cannot show it to users. Use the project's own dev-mode flag for this check; the right one depends on the bundler (for example `process.env.NODE_ENV` in webpack-based setups, `import.meta.env.DEV` in Vite). Read how the project already tells development from production, and reuse that.

Put the switcher in one shared component that both placements use, in the folder where the project keeps shared UI.

## 5. Hand it over

Give the user the URL and the variant keys. Useful feedback is usually a mix, such as "the header from B with the sidebar from C", and that mix is the design they actually want.

## 6. Capture the answer and clean up

When a variant wins, follow section 5 of `SKILL.md`: record which variant won and why, keep the full set on the throwaway branch, and keep only the decision on the default branch.

- **Placement A**: rebuild the winner in the existing page, test-first with the `tdd` skill where it has behavior worth testing. The losing variants and the switcher stay off the default branch.
- **Placement B**: rebuild the winner as a real route the same way. The throwaway route and the switcher stay off the default branch.

The variants are the evidence behind the verdict, so they live on the throwaway branch rather than in the bin. Left on the default branch they rot and confuse the next reader.

## Do not

- **Make variants that differ only in colour or copy.** That is a tweak. Real variants disagree about structure.
- **Share too much between variants.** A shared `<Header>` is fine. A shared `<Layout>` defeats the point, because each variant should be free to drop the layout.
- **Connect variants to real mutations.** Read-only is fine. If a variant must change data, point it at a stub: the question is how it looks, not whether the backend works.
- **Promote the prototype as it is.** Variant code was written without tests and with minimal error handling. Rewrite the winner properly, test-first, when it moves into real code.
