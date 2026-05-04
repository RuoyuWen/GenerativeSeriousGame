import { chatComplete, chatMessageText } from './api';
import { parseJsonObject } from './jsonExtract';
import type {
  AppConfig,
  Bible,
  BibleEntity,
  BibleScene,
  BookPlan,
  ChapterContent,
  ChapterMeta,
  StructureId,
} from './gameTypes';

function structuresBlock(structures: { id: number; content: string }[]) {
  return structures.map((x) => `### 结构模板 ${x.id}\n${x.content}`).join('\n\n---\n\n');
}

export async function llmPlanBook(opts: {
  cfg: AppConfig;
  story: string;
  structures: { id: number; content: string }[];
}): Promise<BookPlan> {
  const { cfg, story, structures } = opts;

  const sys = [
    '你是叙事系统设计师。产物只能是合法 JSON（无多余说明、无代码块外文字）。全部用中文写作（id 例外，用英文 snake_case）。',
    '',
    '两层结构（方案 A）：',
    '1）选定全书结构 bookStructureId ∈ {1,2,3,4,5}。该模板里的每一个节点（N1/N2A/HUB/E1…）都必须精确对应为一章。章数 = 该模板节点数。',
    '2）为每一章在 1-5 中再选一个 chapterStructureId，作为**章内**节点图的模板。',
    '',
    '硬性要求：',
    '- 只借用 NodeStructure 的拓扑，不得复制示例里的专有名词、地点、主题。',
    '- chaptersMeta[i].bookNodeId 必须严格是「全书模板正文里出现过的节点 id」。',
    '- bookEdges 必须覆盖全书模板的所有边；from/to 都取 bookNodeId。',
    '- bible 的 id 用稳定 snake_case；imagePromptAnchors 写**角色/场景身份**级别的视觉锚点（体型/发色/服饰/关键道具等），不要写整体美术风格。',
    '- visualStyle 是**全书统一的美术风格规范**，写成一句可直接拼到生图 prompt 最前面的英文短语串，12–40 词：必须覆盖 medium（如 oil painting / ink wash / cel-shaded 等）、palette（色域与色温）、lighting（光质）、composition/lens（构图 & 焦段）、texture/noise、情绪关键词、以及「consistent across all scenes」之类的稳定性词。不要写具体角色或场景。',
    '- skeletonBeats 每条不超过 20 字，总条目数与该章 chapterStructureId 的内部节点数相当即可。',
    '',
    '输出 schema：',
    '{"bookStructureId":1,"bookStructureRationale":"","visualStyle":"","bible":{"characters":[{"id":"","name":"","role":"","visualAndPersonality":""}],"scenes":[{"id":"","name":"","synopsis":"","imagePromptAnchors":""}]},"chaptersMeta":[{"index":1,"bookNodeId":"N1","title":"","chapterStructureId":1,"structureRationale":"","skeletonBeats":[""]}],"bookEdges":[{"from":"N1","to":"N2A"}]}',
  ].join('\n');

  const user = [
    `故事设计：\n${story}`,
    '',
    `备选结构库：\n\n${structuresBlock(structures)}`,
    '',
    '请选定全书结构与每章结构，并给出 bible 与 bookEdges。',
  ].join('\n');

  const data = await chatComplete(
    cfg,
    [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    0.5,
  );
  const text = chatMessageText(data);
  const plan = parseJsonObject<BookPlan>(text);
  plan.chaptersMeta = (plan.chaptersMeta || []).map((m, i) => ({ ...m, index: i + 1 }));
  return plan;
}

export async function llmExpandBookOutline(opts: {
  cfg: AppConfig;
  story: string;
  book: BookPlan;
  bookStructureContent: string;
}): Promise<string> {
  const { cfg, story, book, bookStructureContent } = opts;
  const sys = [
    '你是编剧。把全书章图扩写成紧凑散文大纲（中文 Markdown）。',
    '要求：严格贴合全书所选 NodeStructure 的章与章衔接；不复制示例主题；行文要引用 bible 的人名与视觉锚点；单章描述不超过 6 句。',
  ].join('\n');

  const user = [
    `原始构想：\n${story}`,
    `\n全书结构正文：\n${bookStructureContent}`,
    `\n规划 JSON：\n${JSON.stringify({
      bookStructureId: book.bookStructureId,
      chaptersMeta: book.chaptersMeta,
      bookEdges: book.bookEdges,
      bible: book.bible,
    })}`,
  ].join('\n');

  const data = await chatComplete(
    cfg,
    [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    0.5,
  );
  return chatMessageText(data);
}

export interface OutgoingBookEdge {
  targetBookNodeId: string;
  targetChapterIndex: number;
  targetTitle: string;
}

export function outgoingEdgesFor(book: BookPlan, chapterIndex: number): OutgoingBookEdge[] {
  const ch = book.chaptersMeta[chapterIndex];
  if (!ch) return [];
  const targets = (book.bookEdges || [])
    .filter((e) => e.from === ch.bookNodeId)
    .map((e) => e.to);
  const list: OutgoingBookEdge[] = [];
  for (const t of targets) {
    const idx = book.chaptersMeta.findIndex((c) => c.bookNodeId === t);
    if (idx >= 0) {
      list.push({
        targetBookNodeId: t,
        targetChapterIndex: idx,
        targetTitle: book.chaptersMeta[idx].title,
      });
    }
  }
  return list;
}

export async function llmChapterNodes(opts: {
  cfg: AppConfig;
  chapter: ChapterMeta;
  chapterStructureContent: string;
  bible: Bible;
  visualStyle: string;
  bookOutline: string;
  outgoing: OutgoingBookEdge[];
}): Promise<ChapterContent> {
  const { cfg, chapter, chapterStructureContent, bible, visualStyle, bookOutline, outgoing } = opts;

  const sys = [
    '你是互动叙事作者。为该章输出 playable 节点表。严格遵守以下。中文（id 英文 snake_case 或模板里的 N*/E*）。',
    '',
    '结构：',
    '- 节点 id 与本章所选模板的节点 id 一一对应（N1…N6 / HUB / E*）。不得增删节点或边。',
    '- 每个非终端节点的 choices 必须等于该节点在模板中的出边数，choice.nextNodeId 必须是模板里的真实后继。',
    '',
    '跨章跳转：',
    '- 本章对应的全书节点是 chapter.bookNodeId；其在全书中的出边已在 outgoing 给出。',
    '- 本章「出口节点」是模板里的终点节点（N6 或 E*）。',
    '- outgoing.length > 0：每个出口节点必须输出等同数量的 choice，choice.nextChapterIndex 取自 outgoing[i].targetChapterIndex；不写 nextNodeId。',
    '- outgoing.length === 0（全书结局章）：出口节点的 choices 为空数组。',
    '- 模板 5（多结局）时，不同 E* 可映射到不同 outgoing 目标；若 outgoing 只有 1 条，所有 E* 指向同一条。',
    '',
    '是否生图（关键新增）：',
    '- 每个节点都必须给布尔字段 imageImportant。',
    '- 仅对「视觉冲击强、情绪关键、揭露/转折/出场亮相」的节点置 true；常规过场/纯信息节点置 false。',
    '- 一章里 imageImportant=true 的节点建议占 30–50%，至少 1 个，最多 ≤ ceil(节点数/2)。',
    '',
    '文本长度（两档）：',
    '- imageImportant=true：narration ≤ 80 字（1–3 短句）；dialogue 0–2 行，每行「角色：≤ 25 字」。',
    '- imageImportant=false：narration 60–160 字（2–4 句，可稍微铺陈环境/内心）；dialogue 0–3 行，每行「角色：≤ 35 字」。',
    '- 不要长段落，不要重复圣经里的描述文字。',
    '',
    'scenePromptForImage 规则（关键改动）：',
    '- imageImportant=false 时，值必须为空字符串 ""。',
    '- imageImportant=true 时：英文为主，≤ 30 词，**只描述「这一刻的动作、镜头/构图、情绪、关键瞬时道具或动作姿态」**。',
    '- 严禁写：整体美术风格（系统会从 visualStyle 注入）；场景的固定外貌（系统会从 sceneId 注入）；角色的外貌/服饰/发色等身份特征（系统会从 npcIds 注入）。',
    '- 因此理想形态像：`a tense hand reaches across the table, low-angle shot, dim warm rim light, close-up`。',
    '',
    '一致性：npcIds、sceneId 必须引用 bible 现有 id；身份信息只通过 id 引用，不要在 scenePromptForImage 里复述。',
    '',
    '输出 JSON schema：',
    '{"meta":<原样回声传入的 chapter>, "nodes":[{"nodeId":"N1","narration":"","dialogue":["角色：…"],"npcIds":[],"sceneId":"","imageImportant":true,"scenePromptForImage":"","choices":[{"id":"c1","label":"","nextNodeId":"N2A"}]}]}',
  ].join('\n');

  const user = [
    `chapter: ${JSON.stringify(chapter)}`,
    `outgoing: ${JSON.stringify(outgoing)}`,
    `\n章内模板全文：\n${chapterStructureContent}`,
    `\n全书统一美术风格（仅供参考，不要写进每个 scenePromptForImage）：\n${visualStyle}`,
    `\nbible: ${JSON.stringify(bible)}`,
    `\n大纲对齐（节选）：\n${bookOutline.slice(0, 8000)}`,
  ].join('\n');

  const data = await chatComplete(
    cfg,
    [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    0.55,
  );
  const text = chatMessageText(data);
  const parsed = parseJsonObject<Omit<ChapterContent, 'meta'> & { meta: ChapterMeta }>(text);
  const nodes = (parsed.nodes || []).map((n) => ({
    ...n,
    imageImportant:
      typeof n.imageImportant === 'boolean'
        ? n.imageImportant
        : Boolean(n.scenePromptForImage),
    scenePromptForImage: n.imageImportant === false ? '' : n.scenePromptForImage || '',
  }));
  return { meta: parsed.meta ?? chapter, nodes };
}

export interface ComposeImagePromptArgs {
  visualStyle: string;
  scene?: BibleScene;
  characters?: BibleEntity[];
  moment: string;
}

export function composeImagePrompt(args: ComposeImagePromptArgs): string {
  const parts: string[] = [];

  const style = (args.visualStyle || '').trim();
  if (style) parts.push(`Art style (consistent across the entire book): ${style}.`);

  if (args.scene) {
    const anchors = (args.scene.imagePromptAnchors || '').trim();
    const synopsis = (args.scene.synopsis || '').trim();
    const sceneLine = [args.scene.name, anchors || synopsis].filter(Boolean).join(' — ');
    if (sceneLine) parts.push(`Scene (keep identical across nodes that share this scene): ${sceneLine}.`);
  }

  const chars = (args.characters || []).filter((c) => !!c);
  if (chars.length) {
    const lines = chars.map((c) => {
      const v = (c.visualAndPersonality || '').trim();
      return `${c.name}${v ? ` — ${v}` : ''}`;
    });
    parts.push(`Characters present (must look the same as in earlier illustrations): ${lines.join('; ')}.`);
  }

  const moment = (args.moment || '').trim();
  if (moment) parts.push(`Moment: ${moment}.`);

  parts.push(
    'Strictly preserve the established art style and character/scene identities. Do not change clothing, hair color, body type, palette, or rendering technique.',
  );

  return parts.join(' ');
}

export function coerceStructureId(n: unknown): StructureId | null {
  const x = typeof n === 'string' ? parseInt(n, 10) : Number(n);
  if (![1, 2, 3, 4, 5].includes(x)) return null;
  return x as StructureId;
}
