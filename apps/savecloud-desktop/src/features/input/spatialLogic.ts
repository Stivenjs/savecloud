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
          return dx > 0 && Math.abs(dy) < Math.abs(dx) * 1.5;
        case "LEFT":
          return dx < 0 && Math.abs(dy) < Math.abs(dx) * 1.5;
        case "DOWN":
          return dy > 0 && Math.abs(dx) < Math.abs(dy) * 1.5;
        case "UP":
          return dy < 0 && Math.abs(dx) < Math.abs(dy) * 1.5;
      }
    })();

    if (!isInCone) continue;

    const euclideanDist = Math.sqrt(dx * dx + dy * dy);
    let mainAxisDist: number;
    let crossAxisDist: number;

    switch (direction) {
      case "RIGHT":
      case "LEFT":
        mainAxisDist = Math.abs(dx);
        crossAxisDist = Math.abs(dy);
        break;
      case "DOWN":
      case "UP":
        mainAxisDist = Math.abs(dy);
        crossAxisDist = Math.abs(dx);
        break;
    }

    const alignmentPenalty = crossAxisDist / (euclideanDist || 1);
    const score = euclideanDist * (1 + alignmentPenalty * 2);

    if (score < bestScore) {
      bestScore = score;
      bestNodeId = node.id;
    }
  }

  return bestNodeId;
}
