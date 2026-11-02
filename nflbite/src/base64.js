import { toByteArray } from "base64-js";

// Luna's native atob decodes UTF-8, but the HTML parser's entity table is binary.
export function atob(value) {
  const bytes = toByteArray(value);
  let result = "";
  for (let index = 0; index < bytes.length; index += 4096) {
    result += String.fromCharCode.apply(null, bytes.subarray(index, index + 4096));
  }
  return result;
}
