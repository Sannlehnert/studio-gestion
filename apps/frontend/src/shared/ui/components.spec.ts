import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import AppButton from "./AppButton.vue";
import TextField from "./TextField.vue";
import FeedbackState from "./FeedbackState.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
afterEach(() => {
  document.body.innerHTML = "";
});
describe("foundation components", () => {
  it("busy Button blocks duplicate clicks and declares busy state", async () => {
    const click = vi.fn();
    const wrapper = mount(AppButton, {
      props: { busy: true, onClick: click },
      slots: { default: "Ingresando" },
    });
    expect(wrapper.attributes("aria-busy")).toBe("true");
    await wrapper.trigger("click");
    expect(click).not.toHaveBeenCalled();
  });
  it("field associates label and error, keeps model in sync", async () => {
    const wrapper = mount(TextField, {
      props: { label: "Email", error: "Revisá el email" },
    });
    expect(wrapper.get("label").attributes("for")).toBe(
      wrapper.get("input").attributes("id"),
    );
    expect(wrapper.get("input").attributes("aria-describedby")).toBe(
      wrapper.get("p").attributes("id"),
    );
    await wrapper.get("input").setValue("a@b.test");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["a@b.test"]);
  });
  it("loading and connection errors offer accessible feedback", async () => {
    const wrapper = mount(FeedbackState, {
      props: { kind: "loading", title: "Verificando" },
    });
    expect(wrapper.attributes("role")).toBe("status");
    await wrapper.setProps({ kind: "error", retry: true });
    await wrapper.get("button").trigger("click");
    expect(wrapper.attributes("role")).toBe("alert");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });
  it("dialog associates title, emits actions and restores triggering focus", async () => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const wrapper = mount(ConfirmDialog, {
      attachTo: document.body,
      props: { open: false, title: "Cerrar sesión", confirmLabel: "Confirmar" },
      slots: { default: "<p>Información relevante</p>" },
    });
    await wrapper.setProps({ open: true });
    expect(wrapper.get("dialog").attributes("aria-labelledby")).toBe(
      wrapper.get("h2").attributes("id"),
    );
    await wrapper.get("dialog").trigger("cancel");
    expect(wrapper.emitted("close")).toHaveLength(1);
    await wrapper.findAll("button")[1]!.trigger("click");
    expect(wrapper.emitted("confirm")).toHaveLength(1);
    await wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
  });
});
