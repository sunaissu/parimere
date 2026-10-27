import { optimizeMix } from "./planning.mjs";

self.onmessage = ({ data }) => {
  const { id, products, base, target } = data;
  try {
    self.postMessage({ id, result: optimizeMix(products, base, target) });
  } catch (error) {
    self.postMessage({ id, error: { name: error.name, message: error.message } });
  }
};
