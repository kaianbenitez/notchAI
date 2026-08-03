/**
 * Shared state shape for the account forms.
 *
 * This lives apart from actions.ts on purpose. That file is a "use server"
 * module, and such a module may export only async functions — Next does not
 * reject anything else, it silently compiles it into a server action. While
 * NO_ERROR lived there it became an async network proxy on the client, so the
 * initial state handed to useActionState was a function rather than an object
 * and `state.error` read as undefined. Nothing looked broken, because undefined
 * is falsy and the error note simply never rendered.
 *
 * Do not move these back.
 */

export interface ActionState {
  error: string | null;
}

export const NO_ERROR: ActionState = { error: null };
