import { FocusNode } from "@features/input/types";

export function findNextNode(
  currentElement: HTMLElement,
  nodes: FocusNode[],
  direction: "UP" | "DOWN" | "LEFT" | "RIGHT"
): string | null {
  const currentRect = currentElement.getBoundingClientRect();
  let bestNodeId: string | null = null;
  let bestScore = Infinity;

  const currentCenterX = currentRect.left + currentRect.width / 2;
  const currentCenterY = currentRect.top + currentRect.height / 2;

  for (const node of nodes) {
    const element = node.getElement();
    if (!element || element === currentElement) continue;

    const rect = element.getBoundingClientRect();
    const targetCenterX = rect.left + rect.width / 2;
    const targetCenterY = rect.top + rect.height / 2;

    const dx = targetCenterX - currentCenterX;
    const dy = targetCenterY - currentCenterY;

    const isInCone = (() => {
      switch (direction) {
        case "RIGHT":
          return dx > 0 && Math.abs(dy) < Math.abs(dx) * 1.8;
        case "LEFT":
          return dx < 0 && Math.abs(dy) < Math.abs(dx) * 1.8;
        case "DOWN":
          return dy > 0 && Math.abs(dx) < Math.abs(dy) * 1.8;
        case "UP":
          return dy < 0 && Math.abs(dx) < Math.abs(dy) * 1.8;
      }
    })();

    if (!isInCone) continue;

    const euclideanDist = Math.sqrt(dx * dx + dy * dy);
    const crossAxisDist = direction === "RIGHT" || direction === "LEFT" ? Math.abs(dy) : Math.abs(dx);
    const alignmentPenalty = crossAxisDist / (euclideanDist || 1);
    const score = euclideanDist * (1 + alignmentPenalty * 2);

    if (score < bestScore) {
      bestScore = score;
      bestNodeId = node.id;
    }
  }

  if (!bestNodeId) {
    let fallbackScore = Infinity;
    for (const node of nodes) {
      const element = node.getElement();
      if (!element || element === currentElement) continue;

      const rect = element.getBoundingClientRect();
      const targetCenterX = rect.left + rect.width / 2;
      const targetCenterY = rect.top + rect.height / 2;

      const dx = targetCenterX - currentCenterX;
      const dy = targetCenterY - currentCenterY;

      const isInHalfPlane = (() => {
        switch (direction) {
          case "RIGHT":
            return dx > 10;
          case "LEFT":
            return dx < -10;
          case "DOWN":
            return dy > 10;
          case "UP":
            return dy < -10;
        }
      })();

      if (!isInHalfPlane) continue;

      const mainAxisDist = direction === "RIGHT" || direction === "LEFT" ? Math.abs(dx) : Math.abs(dy);
      const crossAxisDist = direction === "RIGHT" || direction === "LEFT" ? Math.abs(dy) : Math.abs(dx);

      const score = mainAxisDist * 2 + crossAxisDist;

      if (score < fallbackScore) {
        fallbackScore = score;
        bestNodeId = node.id;
      }
    }
  }

  return bestNodeId;
}
