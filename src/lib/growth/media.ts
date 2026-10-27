// Media embed URL parsing — ONE implementation shared by the React renderer and the portable
// export, so a downloaded page embeds exactly the providers the live page allows. Pure string
// work: no React, no DOM.
export function youTubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}
export function vimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : null;
}
export function loomId(url: string): string | null {
  const m = url.match(/loom\.com\/(?:share|embed)\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

export function embedUrl(provider: string, url: string): string | null {
  switch (provider) {
    case "youtube": {
      const id = youTubeId(url);
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    case "vimeo": {
      const id = vimeoId(url);
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
    case "loom": {
      const id = loomId(url);
      return id ? `https://www.loom.com/embed/${id}` : null;
    }
    default:
      return null;
  }
}
