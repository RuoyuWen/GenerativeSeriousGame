import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfig, Bible, BookPlan, ChapterContent, GameNode } from './gameTypes';
import {
  chatComplete,
  chatMessageText,
  fetchNodeStructures,
  firstImageDataUrl,
  imageGenerate,
  runWithConcurrency,
} from './api';
import {
  composeImagePrompt,
  llmChapterNodes,
  llmExpandBookOutline,
  llmPlanBook,
  outgoingEdgesFor,
} from './pipeline';

const OFFICIAL_BASE = 'https://api.openai.com/v1';
const RELAY_DEFAULT = 'https://xuedingmao.top/v1';

const CHAT_PRESETS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.1', 'gpt-4.1', 'gpt-4o'];
const IMAGE_PRESETS = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1'];
const IMAGE_CONCURRENCY = 2;

type Tab = 'setup' | 'author' | 'play';

function loadCfg(): AppConfig {
  try {
    const raw = sessionStorage.getItem('gsg_cfg');
    if (raw) return JSON.parse(raw) as AppConfig;
  } catch {
    /* ignore */
  }
  return {
    provider: 'relay',
    baseUrl: RELAY_DEFAULT,
    apiKey: '',
    chatModel: 'gpt-5.1',
    imageModel: 'gpt-image-1',
  };
}

function saveCfg(cfg: AppConfig) {
  sessionStorage.setItem('gsg_cfg', JSON.stringify(cfg));
}

function firstPlayableNodeId(ch?: ChapterContent): string | null {
  if (!ch?.nodes?.length) return null;
  return ch.nodes.find((n) => n.nodeId === 'N1')?.nodeId ?? ch.nodes[0].nodeId;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('setup');
  const [cfg, setCfg] = useState<AppConfig>(() => loadCfg());
  const [story, setStory] = useState('');
  const [structures, setStructures] = useState<{ id: number; content: string }[]>([]);
  const [book, setBook] = useState<BookPlan | null>(null);
  const [outline, setOutline] = useState('');
  const [chapters, setChapters] = useState<ChapterContent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [playChapterIndex, setPlayChapterIndex] = useState(0);
  const [playNodeId, setPlayNodeId] = useState<string | null>(null);

  const cfgRef = useRef(cfg);
  useEffect(() => {
    cfgRef.current = cfg;
  }, [cfg]);

  const applyProvider = (p: AppConfig['provider']) => {
    setCfg((c) => {
      const next = { ...c, provider: p };
      if (p === 'official') next.baseUrl = OFFICIAL_BASE;
      if (p === 'relay') next.baseUrl = RELAY_DEFAULT;
      return next;
    });
  };

  const refreshStructures = useCallback(async () => {
    setErr(null);
    const j = await fetchNodeStructures();
    setStructures(j.items.map((x) => ({ id: x.id, content: x.content })));
  }, []);

  const structureText = useCallback(
    (id: number) => structures.find((s) => s.id === id)?.content ?? '',
    [structures],
  );

  const bookStructureBody = useMemo(
    () => (book ? structureText(book.bookStructureId) : ''),
    [book, structureText],
  );

  const currentChapter = chapters[playChapterIndex];
  const currentNode = useMemo<GameNode | null>(() => {
    if (!currentChapter || !playNodeId) return null;
    return currentChapter.nodes.find((n) => n.nodeId === playNodeId) ?? null;
  }, [currentChapter, playNodeId]);

  const updateChapterNode = useCallback((chapterIndex: number, nodeId: string, patch: Partial<GameNode>) => {
    setChapters((prev) => {
      const next = [...prev];
      const ch = next[chapterIndex];
      if (!ch) return prev;
      next[chapterIndex] = {
        ...ch,
        nodes: ch.nodes.map((n) => (n.nodeId === nodeId ? { ...n, ...patch } : n)),
      };
      return next;
    });
  }, []);

  const generateImagesForChapter = useCallback(
    async (
      chapterIndex: number,
      chapter: ChapterContent,
      visualStyle: string,
      bible: Bible,
    ) => {
      const charById = new Map(bible.characters.map((c) => [c.id, c]));
      const sceneById = new Map(bible.scenes.map((s) => [s.id, s]));

      const jobs = chapter.nodes
        .filter((n) => n.imageImportant && n.scenePromptForImage && n.imageStatus !== 'done')
        .map((n) => ({
          nodeId: n.nodeId,
          moment: n.scenePromptForImage,
          scene: sceneById.get(n.sceneId),
          characters: (n.npcIds || []).map((id) => charById.get(id)).filter(Boolean) as Bible['characters'],
        }));

      jobs.forEach((j) => updateChapterNode(chapterIndex, j.nodeId, { imageStatus: 'loading' }));

      await runWithConcurrency(
        jobs,
        async (job) => {
          try {
            const fullPrompt = composeImagePrompt({
              visualStyle,
              scene: job.scene,
              characters: job.characters,
              moment: job.moment,
            });
            const res = await imageGenerate(cfgRef.current, fullPrompt);
            const url = firstImageDataUrl(res);
            if (!url) throw new Error('no image url');
            updateChapterNode(chapterIndex, job.nodeId, { imageDataUrl: url, imageStatus: 'done' });
          } catch (e) {
            updateChapterNode(chapterIndex, job.nodeId, {
              imageStatus: 'error',
              imageError: String(e),
            });
          }
        },
        IMAGE_CONCURRENCY,
      );
    },
    [updateChapterNode],
  );

  const onPlanBook = async () => {
    setErr(null);
    if (!cfg.apiKey.trim()) return setErr('请填写 API Key。');
    if (!story.trim()) return setErr('请先写故事设计。');
    if (!structures.length) await refreshStructures();
    setBusy('正在生成圣经 + 全书结构 + 章节规划…');
    try {
      const plan = await llmPlanBook({ cfg, story, structures });
      setBook(plan);
      setChapters([]);
      setOutline('');
      setPlayChapterIndex(0);
      setPlayNodeId(null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const onExpandOutline = async () => {
    setErr(null);
    if (!book) return;
    setBusy('正在扩写全书大纲…');
    try {
      const text = await llmExpandBookOutline({
        cfg,
        story,
        book,
        bookStructureContent: bookStructureBody,
      });
      setOutline(text);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const generateOneChapter = async (idx: number, currentBook: BookPlan, currentOutline: string) => {
    const ch = currentBook.chaptersMeta[idx];
    if (!ch) return null;
    const body = structureText(ch.chapterStructureId);
    const outgoing = outgoingEdgesFor(currentBook, idx);
    const cc = await llmChapterNodes({
      cfg,
      chapter: ch,
      chapterStructureContent: body,
      bible: currentBook.bible,
      visualStyle: currentBook.visualStyle,
      bookOutline: currentOutline || story,
      outgoing,
    });
    setChapters((prev) => {
      const next = [...prev];
      next[idx] = cc;
      return next;
    });
    void generateImagesForChapter(idx, cc, currentBook.visualStyle, currentBook.bible);
    return cc;
  };

  const onGenChapter = async (idx: number) => {
    setErr(null);
    if (!book) return;
    setBusy(`正在生成第 ${idx + 1} 章…`);
    try {
      await generateOneChapter(idx, book, outline);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const onGenAllChapters = async () => {
    if (!book) return;
    setErr(null);
    for (let i = 0; i < book.chaptersMeta.length; i++) {
      setBusy(`正在生成第 ${i + 1}/${book.chaptersMeta.length} 章…`);
      try {
        await generateOneChapter(i, book, outline);
      } catch (e) {
        setErr(String(e));
        break;
      }
    }
    setBusy(null);
  };

  const beginPlay = () => {
    const firstId = firstPlayableNodeId(chapters[0]);
    if (!firstId) {
      setErr('暂无可玩节点：请先生成章节内容。');
      return;
    }
    setPlayChapterIndex(0);
    setPlayNodeId(firstId);
    setTab('play');
  };

  const onChoice = (choice: { nextNodeId?: string; nextChapterIndex?: number }) => {
    if (!currentChapter) return;
    if (typeof choice.nextChapterIndex === 'number') {
      const nextIdx = choice.nextChapterIndex;
      const nextCh = chapters[nextIdx];
      if (!nextCh) {
        setErr(`第 ${nextIdx + 1} 章尚未生成`);
        return;
      }
      const firstId = firstPlayableNodeId(nextCh);
      if (!firstId) return;
      setPlayChapterIndex(nextIdx);
      setPlayNodeId(firstId);
      return;
    }
    if (choice.nextNodeId) {
      const next = currentChapter.nodes.find((n) => n.nodeId === choice.nextNodeId);
      if (!next) {
        setErr(`找不到下一节点：${choice.nextNodeId}`);
        return;
      }
      setPlayNodeId(next.nodeId);
    }
  };

  const testChat = async () => {
    setErr(null);
    setBusy('正在测试对话接口…');
    try {
      const data = await chatComplete(
        cfg,
        [
          { role: 'system', content: '只用一句话确认你在线。' },
          { role: 'user', content: 'ping' },
        ],
        0.2,
      );
      const t = chatMessageText(data);
      if (!t) throw new Error(JSON.stringify(data));
      alert(t);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const chapterDone = chapters.filter((c) => c?.nodes?.length).length;
  const allChapters = book?.chaptersMeta.length ?? 0;
  const imagesPending = chapters.reduce(
    (acc, ch) =>
      acc + (ch?.nodes.filter((n) => n.imageImportant && n.imageStatus === 'loading').length ?? 0),
    0,
  );
  const isBookEnd =
    !!currentNode && currentNode.choices.length === 0;

  return (
    <div className="layout">
      <h1>生成式严肃游戏 · 管线原型</h1>
      <p className="sub">
        全书与章节均从 <span className="mono">NodeStructure/*.txt</span>{' '}
        选配结构模板；全书模板的每个节点 = 一章；章内选项在出口节点自动连向下一章。API 经本地{' '}
        <span className="mono">/api</span> 转发，可选 OpenAI 官方或兼容中转（见{' '}
        <a
          href="https://s.apifox.cn/0cc9d8a3-2430-47aa-bf45-98c5e07f58cf/doc-5745017"
          style={{ color: 'var(--accent)' }}
        >
          API 快速开始指南
        </a>
        ）。
      </p>

      <div className="tabs">
        <button
          type="button"
          className={`tab ${tab === 'setup' ? 'active' : ''}`}
          onClick={() => setTab('setup')}
        >
          接口与模型
        </button>
        <button
          type="button"
          className={`tab ${tab === 'author' ? 'active' : ''}`}
          onClick={() => setTab('author')}
        >
          故事与生成
        </button>
        <button
          type="button"
          className={`tab ${tab === 'play' ? 'active' : ''}`}
          onClick={() => setTab('play')}
        >
          游玩
        </button>
      </div>

      {tab === 'setup' && (
        <div className="panel">
          <h2>连接方式</h2>
          <div className="row">
            <label>提供方</label>
            <select
              value={cfg.provider}
              onChange={(e) => applyProvider(e.target.value as AppConfig['provider'])}
            >
              <option value="relay">兼容中转（默认 xuedingmao /v1）</option>
              <option value="official">OpenAI 官方（api.openai.com/v1）</option>
              <option value="custom">自定义 Base URL</option>
            </select>
          </div>
          <div className="row">
            <label>Base URL</label>
            <input
              value={cfg.baseUrl}
              disabled={cfg.provider !== 'custom'}
              onChange={(e) => setCfg((c) => ({ ...c, baseUrl: e.target.value.trim() }))}
              placeholder="https://…/v1"
            />
          </div>
          <div className="row">
            <label>API Key</label>
            <input
              value={cfg.apiKey}
              type="password"
              autoComplete="off"
              onChange={(e) => setCfg((c) => ({ ...c, apiKey: e.target.value }))}
              placeholder="sk-… 或中转令牌"
            />
          </div>
          <div className="row">
            <label>对话模型</label>
            <div>
              <select
                value={CHAT_PRESETS.includes(cfg.chatModel) ? cfg.chatModel : '__custom__'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__custom__') return;
                  setCfg((c) => ({ ...c, chatModel: v }));
                }}
              >
                {CHAT_PRESETS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value="__custom__">自定义…</option>
              </select>
              {!CHAT_PRESETS.includes(cfg.chatModel) && (
                <input
                  style={{ marginTop: 8 }}
                  value={cfg.chatModel}
                  onChange={(e) => setCfg((c) => ({ ...c, chatModel: e.target.value.trim() }))}
                  placeholder="手动填写模型名"
                />
              )}
            </div>
          </div>
          <div className="row">
            <label>场景生图模型</label>
            <select
              value={cfg.imageModel}
              onChange={(e) => setCfg((c) => ({ ...c, imageModel: e.target.value }))}
            >
              {IMAGE_PRESETS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="btn-row">
            <button
              type="button"
              onClick={() => {
                saveCfg(cfg);
              }}
            >
              记住本页设置
            </button>
            <button type="button" className="primary" disabled={!!busy} onClick={testChat}>
              测试对话
            </button>
            <button type="button" onClick={refreshStructures}>
              预加载 NodeStructure
            </button>
          </div>

          <p className="hint">
            服务端会把请求规范到 <span className="mono">/v1/chat/completions</span> 与{' '}
            <span className="mono">/v1/images/generations</span>。
          </p>
          {structures.length > 0 && <p className="ok">已载入 {structures.length} 套结构模板。</p>}
          {err && tab === 'setup' && <div className="error">{err}</div>}
        </div>
      )}

      {tab === 'author' && (
        <>
          <div className="panel">
            <h2>故事设计</h2>
            <textarea
              value={story}
              onChange={(e) => setStory(e.target.value)}
              placeholder="主题、时代、主人公目标、冲突来源、你想让玩家感到的东西。"
            />
            <div className="btn-row">
              <button type="button" className="primary" disabled={!!busy} onClick={onPlanBook}>
                1）规划全书（结构 + 章节 + 圣经）
              </button>
              <button type="button" disabled={!!busy || !book} onClick={onExpandOutline}>
                2）扩写大纲（可选）
              </button>
              <button type="button" className="primary" disabled={!!busy || !book} onClick={onGenAllChapters}>
                3）一键生成所有章节（文字 + 并发生图）
              </button>
            </div>
            {busy && <p className="hint">{busy}</p>}
            {!busy && book && (
              <p className="hint">
                已完成章节：{chapterDone}/{allChapters}
                {imagesPending ? `；后台生图中：${imagesPending}` : ''}
              </p>
            )}
            {err && <div className="error">{err}</div>}
          </div>

          {book && (
            <div className="panel">
              <h2>
                规划结果（全书结构 {book.bookStructureId}；共 {book.chaptersMeta.length} 章）
              </h2>
              <p className="hint mono">{book.bookStructureRationale}</p>

              <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
                {book.chaptersMeta.map((ch, idx) => {
                  const data = chapters[idx];
                  const hasContent = !!data?.nodes?.length;
                  const importantNodes = data?.nodes.filter((n) => n.imageImportant) ?? [];
                  const loadingImgs = importantNodes.filter((n) => n.imageStatus === 'loading').length;
                  const doneImgs = importantNodes.filter((n) => n.imageStatus === 'done').length;
                  return (
                    <div
                      key={ch.index}
                      className="mono"
                      style={{ display: 'flex', gap: 10, alignItems: 'center' }}
                    >
                      <span style={{ flex: 1 }}>
                        第 {idx + 1} 章｜book:{ch.bookNodeId}｜内部模板 {ch.chapterStructureId}｜{ch.title}
                        {hasContent
                          ? `（✓ 图 ${doneImgs}/${importantNodes.length}${loadingImgs ? `，生成中 ${loadingImgs}` : ''}）`
                          : ''}
                      </span>
                      <button type="button" disabled={!!busy} onClick={() => onGenChapter(idx)}>
                        {hasContent ? '重新生成' : '生成本章'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {outline && (
                <>
                  <h3 style={{ marginTop: 14 }}>大纲</h3>
                  <textarea className="mono" style={{ minHeight: 180 }} readOnly value={outline} />
                </>
              )}

              <details style={{ marginTop: 12 }}>
                <summary className="hint">查看完整规划 JSON</summary>
                <textarea
                  className="mono"
                  style={{ minHeight: 180, marginTop: 8 }}
                  readOnly
                  value={JSON.stringify(book, null, 2)}
                />
              </details>

              <div className="btn-row" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="primary"
                  disabled={!!busy || !chapters[0]?.nodes?.length}
                  onClick={beginPlay}
                >
                  进入游玩
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'play' && (
        <div className="panel play">
          <h2>文字冒险</h2>
          {!chapters.length ? (
            <p className="hint">请先在「故事与生成」里生成至少第 1 章。</p>
          ) : !currentChapter || !currentNode ? (
            <p className="hint">当前章尚未生成或无节点。</p>
          ) : (
            <>
              <p className="mono" style={{ color: 'var(--muted)', margin: 0 }}>
                第 {playChapterIndex + 1} 章｜{currentChapter.meta.title}｜节点 {currentNode.nodeId}
                {currentNode.imageImportant ? '' : '（无图）'}
              </p>

              {currentNode.imageImportant && <SceneImage node={currentNode} />}

              <div>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: '1.02rem' }}>
                  {currentNode.narration}
                </p>
                {currentNode.dialogue?.length ? (
                  <ul style={{ lineHeight: 1.7 }}>
                    {currentNode.dialogue.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {isBookEnd ? (
                <div className="ok">全书结局达成。</div>
              ) : (
                <div className="choice-list">
                  {currentNode.choices.map((c) => {
                    const jumping =
                      typeof c.nextChapterIndex === 'number'
                        ? ` → 第 ${c.nextChapterIndex + 1} 章`
                        : '';
                    const nextChapterReady =
                      typeof c.nextChapterIndex !== 'number' ||
                      !!chapters[c.nextChapterIndex]?.nodes?.length;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={!nextChapterReady}
                        onClick={() => onChoice(c)}
                      >
                        {c.label}
                        <span style={{ color: 'var(--muted)', marginLeft: 8 }}>
                          {nextChapterReady ? jumping : '（下一章生成中…）'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <details style={{ marginTop: 6 }}>
                <summary className="hint">调试：跳转章节</summary>
                <select
                  style={{ marginTop: 6 }}
                  value={playChapterIndex}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    setPlayChapterIndex(idx);
                    setPlayNodeId(firstPlayableNodeId(chapters[idx]));
                  }}
                >
                  {chapters.map((ch, i) => (
                    <option key={i} value={i}>
                      第 {i + 1} 章｜{ch?.meta.title ?? '未加载'}
                    </option>
                  ))}
                </select>
              </details>
            </>
          )}
          {err && <div className="error">{err}</div>}
        </div>
      )}
    </div>
  );
}

function SceneImage({ node }: { node: GameNode }) {
  if (node.imageDataUrl) {
    return <img alt="scene" src={node.imageDataUrl} />;
  }
  const label =
    node.imageStatus === 'error'
      ? `生图失败：${node.imageError ?? ''}`
      : node.imageStatus === 'loading'
        ? '场景图生成中…'
        : '等待生图';
  return (
    <div
      style={{
        width: '100%',
        aspectRatio: '1 / 1',
        maxHeight: 420,
        border: '1px solid var(--border)',
        borderRadius: 12,
        background:
          'repeating-linear-gradient(45deg, #10131a, #10131a 10px, #141925 10px, #141925 20px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--muted)',
      }}
    >
      {label}
    </div>
  );
}
