// screens/components/SimpleHtml.tsx
// Renders a constrained subset of user-typed HTML as native Text/View
// components - used by StockNotesSection so notes can contain basic
// formatting (bold, links, lists, etc.) instead of only plain text.
//
// Deliberately NOT a WebView and NOT a general-purpose HTML engine. This
// project has no WebView dependency (see package.json), and pulling one in
// just to render a paragraph of formatting would be a lot of native-module
// weight for a personal notes feature. Hand-rolling a small tag allowlist
// also means there is no `<script>`/`dangerouslySetInnerHTML`-shaped attack
// surface to worry about in the first place - every tag not on the
// allowlist below is simply unwrapped down to its plain text content, never
// executed or otherwise specially interpreted.
//
// Supported tags: p, div, br, b/strong, i/em, u, s/strike/del, code, a[href]
// (http/https only), img[src] (http/https only - no data: URIs, see the
// parseSrc doc comment for why), ul/ol/li, h1/h2/h3, blockquote, span.
// Anything else has its tags stripped but its text content kept, so a
// pasted snippet with an unsupported tag degrades to readable text instead
// of vanishing or showing raw markup.

import React from 'react';
import { View, Text, Image, Linking, StyleSheet } from 'react-native';
import { spacing, radii, fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';

type HtmlNode =
  | { type: 'text'; value: string }
  | { type: 'element'; tag: string; href?: string; src?: string; children: HtmlNode[] };

const VOID_TAGS = new Set(['br', 'hr', 'img']);

const ENTITY_MAP: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '\u2014', ndash: '\u2013',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, code: string) => {
    if (code[0] === '#') {
      const codePoint = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (Number.isFinite(codePoint)) {
        try { return String.fromCodePoint(codePoint); } catch { return full; }
      }
      return full;
    }
    return ENTITY_MAP[code.toLowerCase()] ?? full;
  });
}

function parseAttrs(raw: string): { href?: string } {
  const hrefMatch = raw.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const href = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2]) : undefined;
  // Only allow http(s) links to be pressable - a javascript:/data: href just
  // renders as plain non-interactive text instead.
  return { href: href && /^https?:\/\//i.test(href) ? href : undefined };
}

/** http(s) only, same reasoning as parseAttrs' href - plus a practical
 *  reason specific to images: notes sync through Firestore now (see
 *  syncEngine.ts), which caps a single document at ~1MiB. A data: URI
 *  screenshot pasted in as base64 text could burn through a large chunk of
 *  that on its own and break sync for this note (and, depending on batch
 *  packing, others pushed alongside it) - a plain URL avoids that risk
 *  entirely by keeping the actual image bytes off-device. */
function parseSrc(raw: string): string | undefined {
  const srcMatch = raw.match(/src\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const src = srcMatch ? (srcMatch[1] ?? srcMatch[2]) : undefined;
  return src && /^https?:\/\//i.test(src) ? src : undefined;
}

/** Hand-scanned (not a single regex.exec loop) so `<script>`/`<style>`
 *  content can be swallowed wholesale rather than leaking out as visible
 *  text nodes - those two tags are the one case where "unwrap unknown tags
 *  but keep their text" would be actively wrong. */
function parseHtml(html: string): HtmlNode[] {
  const root: { tag: string; children: HtmlNode[] } = { tag: 'root', children: [] };
  const stack: { tag: string; children: HtmlNode[] }[] = [root];
  const lower = html.toLowerCase();
  let i = 0;

  while (i < html.length) {
    if (html[i] !== '<') {
      const next = html.indexOf('<', i);
      const raw = next === -1 ? html.slice(i) : html.slice(i, next);
      const text = decodeEntities(raw);
      if (text.length > 0) stack[stack.length - 1].children.push({ type: 'text', value: text });
      i = next === -1 ? html.length : next;
      continue;
    }

    // HTML comment - skip entirely.
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }

    const tagEnd = html.indexOf('>', i);
    if (tagEnd === -1) break; // malformed trailing "<" - stop rather than loop forever
    const raw = html.slice(i, tagEnd + 1);
    const nameMatch = raw.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/);
    if (!nameMatch) { i = tagEnd + 1; continue; } // "<" that isn't actually a tag - drop it

    const tag = nameMatch[1].toLowerCase();
    const isClosing = raw[1] === '/';

    if (!isClosing && (tag === 'script' || tag === 'style')) {
      const closeIdx = lower.indexOf(`</${tag}`, tagEnd + 1);
      if (closeIdx === -1) { i = html.length; break; }
      const closeEnd = html.indexOf('>', closeIdx);
      i = closeEnd === -1 ? html.length : closeEnd + 1;
      continue;
    }

    if (isClosing) {
      for (let j = stack.length - 1; j >= 1; j--) {
        if (stack[j].tag === tag) { stack.length = j; break; }
      }
      i = tagEnd + 1;
      continue;
    }

    const isVoid = VOID_TAGS.has(tag) || raw.endsWith('/>');
    const el: HtmlNode = {
      type: 'element', tag, children: [],
      ...(tag === 'a' ? parseAttrs(raw) : {}),
      ...(tag === 'img' ? { src: parseSrc(raw) } : {}),
    };
    stack[stack.length - 1].children.push(el);
    if (!isVoid) stack.push({ tag, children: (el as any).children });
    i = tagEnd + 1;
  }

  return root.children;
}

function isWhitespace(s: string): boolean {
  return /^\s*$/.test(s);
}

/** Fetches the remote image's real dimensions (Image.getSize) so it can be
 *  laid out at its correct aspect ratio - RN's <Image> has no intrinsic
 *  sizing the way a browser <img> does, so without this every screenshot
 *  would either collapse to 0x0 or need a guessed, likely-wrong ratio.
 *  Falls back to a small "unavailable" placeholder on a load error (dead
 *  link, offline, etc.) rather than leaving a blank gap with no explanation. */
function NoteImage({ src, colors, styles }: { src: string; colors: ThemeColors; styles: ReturnType<typeof createStyles> }) {
  const [aspectRatio, setAspectRatio] = React.useState<number | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setAspectRatio(null);
    Image.getSize(
      src,
      (w, h) => { if (!cancelled && w > 0 && h > 0) setAspectRatio(w / h); },
      () => { if (!cancelled) setFailed(true); }
    );
    return () => { cancelled = true; };
  }, [src]);

  if (failed) {
    return (
      <View style={styles.imageFallback}>
        <Text style={styles.imageFallbackText} numberOfLines={1}>Image unavailable - {src}</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: src }}
      resizeMode="contain"
      style={[styles.image, { aspectRatio: aspectRatio ?? 16 / 9 }]}
    />
  );
}

/** Renders a block's children as a mix of text runs and standalone images,
 *  rather than one <Text> wrapping everything - an <Image> can't be
 *  reliably nested inside <Text> the way inline formatting tags can, so any
 *  <img> found among a paragraph/heading/etc.'s children splits the block:
 *  text-before becomes its own <Text>, the image becomes its own element,
 *  text-after becomes another <Text>. For the common case of no nested
 *  image at all, this produces exactly the single <Text> it always did. */
function renderMixedContent(
  children: HtmlNode[], keyPrefix: string, colors: ThemeColors, styles: ReturnType<typeof createStyles>, textStyle: object
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let buffer: HtmlNode[] = [];
  let bufIdx = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    out.push(
      <Text key={`${keyPrefix}-t${bufIdx}`} style={textStyle}>
        {buffer.map((c, i) => renderInline(c, `${keyPrefix}-t${bufIdx}-${i}`, colors, styles))}
      </Text>
    );
    buffer = [];
    bufIdx++;
  };

  children.forEach((child, i) => {
    if (child.type === 'element' && child.tag === 'img') {
      flush();
      if (child.src) out.push(<NoteImage key={`${keyPrefix}-img${i}`} src={child.src} colors={colors} styles={styles} />);
    } else {
      buffer.push(child);
    }
  });
  flush();
  return out;
}

function renderInline(node: HtmlNode, key: string, colors: ThemeColors, styles: ReturnType<typeof createStyles>): React.ReactNode {
  if (node.type === 'text') return node.value;

  const kids = () => node.children.map((c, i) => renderInline(c, `${key}-${i}`, colors, styles));

  switch (node.tag) {
    case 'br':
      return '\n';
    case 'img':
      // Images are handled structurally by renderMixedContent/renderBlocks
      // (split out into their own block-level element), not nested inside a
      // <Text> - if one reaches here it's a stray <img> deep inside another
      // inline tag (e.g. "<b><img ...></b>"), which just gets dropped
      // rather than rendered somewhere it can't lay out correctly.
      return null;
    case 'b':
    case 'strong':
      return <Text key={key} style={styles.bold}>{kids()}</Text>;
    case 'i':
    case 'em':
      return <Text key={key} style={styles.italic}>{kids()}</Text>;
    case 'u':
      return <Text key={key} style={styles.underline}>{kids()}</Text>;
    case 's':
    case 'strike':
    case 'del':
      return <Text key={key} style={styles.strikethrough}>{kids()}</Text>;
    case 'code':
      return <Text key={key} style={styles.code}>{kids()}</Text>;
    case 'a':
      return node.href ? (
        <Text key={key} style={styles.link} onPress={() => Linking.openURL(node.href!).catch(() => {})}>
          {kids()}
        </Text>
      ) : (
        <Text key={key}>{kids()}</Text>
      );
    default:
      // Unknown or block-level tag encountered mid-inline-flow (e.g. a
      // stray <div> inside a <p>) - unwrap it, keep its content.
      return <Text key={key}>{kids()}</Text>;
  }
}

function renderList(node: HtmlNode, key: string, colors: ThemeColors, styles: ReturnType<typeof createStyles>): React.ReactNode {
  const ordered = node.tag === 'ol';
  const items = node.children.filter((c): c is HtmlNode & { type: 'element' } => c.type === 'element' && c.tag === 'li');
  return (
    <View key={key} style={styles.list}>
      {items.map((li, idx) => (
        <View key={`${key}-li-${idx}`} style={styles.listItemRow}>
          <Text style={styles.listBullet}>{ordered ? `${idx + 1}.` : '\u2022'}</Text>
          <Text style={styles.listItemText}>{li.children.map((c, i) => renderInline(c, `${key}-li-${idx}-${i}`, colors, styles))}</Text>
        </View>
      ))}
    </View>
  );
}

function renderBlocks(nodes: HtmlNode[], colors: ThemeColors, styles: ReturnType<typeof createStyles>, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  nodes.forEach((node, i) => {
    const key = `${keyPrefix}-${i}`;
    if (node.type === 'text') {
      if (!isWhitespace(node.value)) out.push(<Text key={key} style={styles.paragraph}>{node.value}</Text>);
      return;
    }
    switch (node.tag) {
      case 'img':
        if (node.src) out.push(<NoteImage key={key} src={node.src} colors={colors} styles={styles} />);
        return;
      case 'h1':
        out.push(...renderMixedContent(node.children, key, colors, styles, styles.h1));
        return;
      case 'h2':
        out.push(...renderMixedContent(node.children, key, colors, styles, styles.h2));
        return;
      case 'h3':
        out.push(...renderMixedContent(node.children, key, colors, styles, styles.h3));
        return;
      case 'blockquote':
        out.push(
          <View key={key} style={styles.blockquote}>
            {renderMixedContent(node.children, key, colors, styles, styles.blockquoteText)}
          </View>
        );
        return;
      case 'ul':
      case 'ol':
        out.push(renderList(node, key, colors, styles));
        return;
      case 'p':
      case 'div':
      case 'li': // a stray <li> with no <ul>/<ol> wrapper - treat as its own paragraph rather than dropping it
        out.push(...renderMixedContent(node.children, key, colors, styles, styles.paragraph));
        return;
      default:
        // Inline tag (or unknown tag) sitting at the top level with no
        // block wrapper, e.g. bare "<b>text</b>" - wrap it in a paragraph
        // so it still gets normal paragraph spacing.
        out.push(<Text key={key} style={styles.paragraph}>{renderInline(node, key, colors, styles)}</Text>);
    }
  });
  return out;
}

export default function SimpleHtml({ html }: { html: string }) {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const trimmed = html.trim();
  // Hooks called unconditionally (before the early return below) - a
  // conditional useMemo would break the rules of hooks the moment `html`
  // toggles between empty and non-empty across renders.
  const nodes = React.useMemo(() => parseHtml(trimmed), [trimmed]);
  if (!trimmed) return null;

  const blocks = renderBlocks(nodes, colors, styles, 'b');
  if (blocks.length === 0) return null;
  return <View>{blocks}</View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  paragraph: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.onSurface, marginBottom: spacing.xs },
  h1: { fontFamily: fonts.bodyBold, fontSize: 19, lineHeight: 24, color: colors.onSurface, marginBottom: spacing.xs },
  h2: { fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 22, color: colors.onSurface, marginBottom: spacing.xs },
  h3: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 20, color: colors.onSurface, marginBottom: spacing.xs },
  bold: { fontFamily: fonts.bodyBold },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  strikethrough: { textDecorationLine: 'line-through' },
  code: {
    fontFamily: fonts.mono, fontSize: 13, color: colors.onSurface,
    backgroundColor: colors.surfaceContainerHigh, paddingHorizontal: 4, borderRadius: 4,
  },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  image: {
    width: '100%', maxHeight: 320, borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerHigh, marginBottom: spacing.xs,
  },
  imageFallback: {
    width: '100%', height: 72, borderRadius: radii.lg, backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, marginBottom: spacing.xs,
  },
  imageFallbackText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant },
  blockquote: {
    borderLeftWidth: 3, borderLeftColor: colors.outline, paddingLeft: spacing.sm,
    marginBottom: spacing.xs,
  },
  blockquoteText: { fontFamily: fonts.bodyMedium, fontStyle: 'italic', fontSize: 14, lineHeight: 20, color: colors.onSurfaceVariant },
  list: { marginBottom: spacing.xs },
  listItemRow: { flexDirection: 'row', gap: 6, marginBottom: 2 },
  listBullet: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.onSurfaceVariant, width: 16 },
  listItemText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.onSurface },
});
