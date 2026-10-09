/** All <video> elements under `root`, including the ones inside open shadow roots. */
export function findVideos(root: ParentNode = document): HTMLVideoElement[] {
  const found = new Set<HTMLVideoElement>();

  const visit = (node: ParentNode) => {
    node.querySelectorAll('video').forEach((video) => found.add(video));
    node.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) visit(el.shadowRoot);
    });
  };

  visit(root);
  return [...found];
}
