// Public surface of the framework-agnostic core.
// NOTHING here may import next/* or react (enforced by the boundary lint rule).
export { generateId, isOpaqueId, ID_LENGTH, ID_PATTERN } from "./ids/generateId";
