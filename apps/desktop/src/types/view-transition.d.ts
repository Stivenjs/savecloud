export {};

declare global {
  interface ViewTransition {
    finished: Promise<void>;
    ready: Promise<void>;
    updateCallbackDone: Promise<void>;
  }

  interface Document {
    startViewTransition?: (callback: () => void | Promise<void>) => ViewTransition;
  }

  interface CSSStyleDeclaration {
    viewTransitionName?: string;
  }
}

declare module "react" {
  interface ViewTransitionInstance {
    old: Element;
    new: Element;
    name: string;
    group: Element;
    imagePair: Element;
  }

  interface ViewTransitionProps {
    children?: ReactNode;
    name?: string;
    default?: string | "auto" | "none" | Record<string, string>;
    enter?: string | "auto" | "none" | Record<string, string>;
    exit?: string | "auto" | "none" | Record<string, string>;
    update?: string | "auto" | "none" | Record<string, string>;
    share?: string | "auto" | "none" | Record<string, string>;
    onEnter?: (instance: ViewTransitionInstance, types: string[]) => (() => void) | void;
    onExit?: (instance: ViewTransitionInstance, types: string[]) => (() => void) | void;
    onUpdate?: (instance: ViewTransitionInstance, types: string[]) => (() => void) | void;
    onShare?: (instance: ViewTransitionInstance, types: string[]) => (() => void) | void;
  }

  export const ViewTransition: FC<ViewTransitionProps>;
  export function addTransitionType(type: string): void;
}
