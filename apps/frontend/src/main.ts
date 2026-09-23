import { captureActivation } from "./features/auth/activation";
const activation = captureActivation(window.location, window.history);
// Dynamic import ensures no Router/application observer sees the activation fragment.
void import("./app/bootstrap").then(({ mount }) => mount(activation));
