/**
 * Browser page translation (Google Translate in Chrome, on phones too) swaps the text React drew for its own <font>
 * elements. When React later changes or removes that text it calls removeChild / insertBefore with a node that is no
 * longer where React left it, the DOM throws, and the whole page falls over to the error screen (seen on the form
 * builder: translate the page, edit the title, press Discard). These two guards let React carry on instead:
 * a node that has already been moved is not removed twice, and an insert before a moved node goes at the end.
 * See https://github.com/facebook/react/issues/11538. Text the translator replaced may stay in its translated
 * form until the page reloads; the app's own मराठी / English switch has no such problem.
 */
export function guardAgainstPageTranslation() {
  if (typeof Node !== "function" || !Node.prototype) return;
  const proto = Node.prototype as Node & { __translateGuard?: boolean };
  if (proto.__translateGuard) return;
  proto.__translateGuard = true;

  const removeChild = proto.removeChild;
  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      if (import.meta.env.DEV) console.warn("removeChild: node moved by page translation, skipped", child);
      return child;
    }
    return removeChild.call(this, child) as T;
  };

  const insertBefore = proto.insertBefore;
  proto.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) {
      if (import.meta.env.DEV) console.warn("insertBefore: reference moved by page translation, appended", ref);
      return insertBefore.call(this, node, null) as T;
    }
    return insertBefore.call(this, node, ref) as T;
  };
}
