"use client";

import { startTransition, useActionState, type FormEvent } from "react";

/**
 * useActionState sans la remise à zéro automatique du formulaire de React 19 :
 * après une erreur (ou un succès), ce qui a été saisi reste affiché.
 * Le bouton cliqué (name/value, ex. intent=approve) est transmis comme avec un envoi natif.
 */
export function useKeptForm<State>(action: (state: Awaited<State>, formData: FormData) => Promise<State>, initialState: Awaited<State>) {
  const [state, dispatch, pending] = useActionState<State, FormData>(action, initialState);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  };
  return { state, pending, onSubmit };
}
