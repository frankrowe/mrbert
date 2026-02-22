import { useState, useRef, useEffect } from "react";
import "./App.css";

const TOPICS_DELIMITER = "---TOPICS---";
const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const STACK_OFFSET_DESKTOP = 10; // px per page on desktop
const STACK_OFFSET_MOBILE = 4; // px per page on mobile (<=600px wide)

function getStackOffset() {
  return window.innerWidth <= 600 ? STACK_OFFSET_MOBILE : STACK_OFFSET_DESKTOP;
}

function parseBlocks(content) {
  const blocks = [];

  // Extract [FACTS]...[/FACTS] block if present
  let remaining = content;
  const factsStart = content.indexOf('[FACTS]');
  if (factsStart !== -1) {
    const factsEnd = content.indexOf('[/FACTS]');
    if (factsEnd !== -1) {
      try {
        const facts = JSON.parse(content.slice(factsStart + 7, factsEnd).trim());
        blocks.push({ type: 'facts', facts });
      } catch (e) { /* malformed JSON, skip */ }
      remaining = content.slice(factsEnd + 8).trim();
    } else {
      // Incomplete while streaming — hide everything from [FACTS] onward
      remaining = content.slice(0, factsStart).trim();
    }
  }

  let paraLines = [];
  for (const line of remaining.split('\n')) {
    if (line.startsWith('## ')) {
      if (paraLines.length) {
        blocks.push({ type: 'p', text: paraLines.join(' ').trim() });
        paraLines = [];
      }
      blocks.push({ type: 'h2', text: line.slice(3).trim() });
    } else if (line.trim() === '') {
      if (paraLines.length) {
        blocks.push({ type: 'p', text: paraLines.join(' ').trim() });
        paraLines = [];
      }
    } else {
      paraLines.push(line.trim());
    }
  }
  if (paraLines.length) {
    blocks.push({ type: 'p', text: paraLines.join(' ').trim() });
  }
  return blocks;
}

export default function App() {
  const [input, setInput] = useState("");
  const [pages, setPages] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [stackOffset, setStackOffset] = useState(getStackOffset);
  const pageRef = useRef(null);

  // Update stack offset on resize / orientation change
  useEffect(() => {
    function onResize() {
      setStackOffset(getStackOffset());
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const currentPage = pages[activeIndex] ?? null;

  // Scroll active page to top whenever it changes
  useEffect(() => {
    if (pageRef.current) {
      pageRef.current.scrollTop = 0;
    }
  }, [activeIndex]);

  async function explore(topic, basePath) {
    if (isStreaming) return;
    setIsStreaming(true);
    setStreamingContent("");

    const newPage = { topic, content: "", subtopics: [] };
    const newPages = [...basePath, newPage];
    setPages(newPages);
    setActiveIndex(newPages.length - 1);

    try {
      const res = await fetch(`${API_BASE}/api/explore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, path: basePath.map((p) => p.topic) }),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);
          if (raw === "[DONE]") continue;

          try {
            const parsed = JSON.parse(raw);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.content) {
              accumulated += parsed.content;
              const delimIdx = accumulated.indexOf(TOPICS_DELIMITER);
              if (delimIdx !== -1) {
                setStreamingContent(accumulated.slice(0, delimIdx).trim());
              } else {
                setStreamingContent(accumulated);
              }
            }
          } catch (err) {
            console.error("Stream parse error:", err);
          }
        }
      }

      const delimIdx = accumulated.indexOf(TOPICS_DELIMITER);
      let finalContent = accumulated.trim();
      let subtopics = [];

      if (delimIdx !== -1) {
        finalContent = accumulated.slice(0, delimIdx).trim();
        const topicsRaw = accumulated
          .slice(delimIdx + TOPICS_DELIMITER.length)
          .trim();
        try {
          subtopics = JSON.parse(topicsRaw);
        } catch (e) {
          console.error("Failed to parse subtopics JSON:", topicsRaw);
        }
      }

      setPages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          topic,
          content: finalContent,
          subtopics,
        };
        return updated;
      });
    } catch (err) {
      setPages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          topic,
          content: `Could not load content: ${err.message}`,
          subtopics: [],
          error: true,
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
    }
  }

  function handleSearch(e) {
    e.preventDefault();
    const topic = input.trim();
    if (!topic || isStreaming) return;
    setInput("");
    explore(topic, []);
  }

  function handleSubtopic(subtopic) {
    if (isStreaming) return;
    explore(subtopic, pages.slice(0, activeIndex + 1));
  }

  function handleBreadcrumb(index) {
    if (isStreaming) return;
    setActiveIndex(index);
  }

  function handleHome() {
    if (isStreaming) return;
    setPages([]);
    setActiveIndex(0);
    setInput("");
  }

  const displayContent = isStreaming
    ? streamingContent
    : (currentPage?.content ?? "");
  const showSubtopics =
    !isStreaming && (currentPage?.subtopics?.length ?? 0) > 0;

  // Previous pages peek out to the LEFT (all of them, no limit)
  const leftShadows = pages.slice(0, activeIndex).map((page, i, arr) => ({
    page,
    depth: arr.length - i, // 1 = directly behind, N = deepest
    targetIndex: i,
  }));

  // Subsequent pages peek out to the RIGHT (all of them, no limit)
  const rightShadows = pages.slice(activeIndex + 1).map((page, i) => ({
    page,
    depth: i + 1, // 1 = directly behind, N = deepest
    targetIndex: activeIndex + i + 1,
  }));

  const leftStackWidth = leftShadows.length * stackOffset;
  const rightStackWidth = rightShadows.length * stackOffset;

  // ── Home screen ──────────────────────────────────────────────
  if (pages.length === 0) {
    return (
      <div className="home">
        <div className="home-inner">
          <img src="/mrbert.png" alt="Mr. Bert" className="home-logo" />
          <h1 className="home-title">Mr. Bert</h1>
          <p className="home-subtitle">Enter any topic to begin reading.</p>
          <form className="home-form" onSubmit={handleSearch}>
            <input
              className="home-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. The Roman Empire, Quantum Mechanics, Jazz..."
              autoFocus
            />
            <button className="home-btn" type="submit" disabled={!input.trim()}>
              Begin
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Article screen ───────────────────────────────────────────
  return (
    <div className="app">
      <header className="topbar">
        <button className="topbar-home" onClick={handleHome} title="Home">
          <img src="/mrbert.png" alt="Mr. Bert" className="topbar-logo" />
          <span className="topbar-title">Mr. Bert</span>
        </button>
        <span className="topbar-topic">{currentPage.topic}</span>
      </header>

      {/* Book stack */}
      <main className="content">
        <div
          className="book-container"
          style={{
            "--left-stack": `${leftStackWidth}px`,
            "--right-stack": `${rightStackWidth}px`,
          }}
        >
          {/* Previous pages — peek out to the LEFT */}
          {leftShadows.map(({ page, depth, targetIndex }) => (
            <div
              key={`l${targetIndex}`}
              className="book-page book-page--shadow"
              style={{
                zIndex: leftShadows.length - depth + 1,
                transform: `translateX(-${depth * stackOffset}px)`,
              }}
              onClick={() => handleBreadcrumb(targetIndex)}
              title={page.topic}
            />
          ))}

          {/* Subsequent pages — peek out to the RIGHT */}
          {rightShadows.map(({ page, depth, targetIndex }) => (
            <div
              key={`r${targetIndex}`}
              className="book-page book-page--shadow"
              style={{
                zIndex: rightShadows.length - depth + 1,
                transform: `translateX(${depth * stackOffset}px)`,
              }}
              onClick={() => handleBreadcrumb(targetIndex)}
              title={page.topic}
            />
          ))}

          {/* Active page */}
          <div
            ref={pageRef}
            className="book-page book-page--active"
            style={{ zIndex: pages.length + 1 }}
          >
            <h1 className="article-title">{currentPage.topic}</h1>

            <div
              className={`article-body${currentPage.error ? " article-error" : ""}`}
            >
              {parseBlocks(displayContent).map((block, i) => {
                if (block.type === 'facts') {
                  return (
                    <div key={i} className="facts-box">
                      <h3 className="facts-title">Quick Facts</h3>
                      <dl className="facts-list">
                        {Object.entries(block.facts).map(([k, v]) => (
                          <div key={k} className="facts-row">
                            <dt className="facts-key">{k}</dt>
                            <dd className="facts-value">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  );
                }
                if (block.type === 'h2') {
                  return <h2 key={i} className="article-section-heading">{block.text}</h2>;
                }
                return <p key={i}>{block.text}</p>;
              })}
              {isStreaming && <span className="cursor" aria-hidden="true" />}
            </div>

            {showSubtopics && (
              <section className="subtopics">
                <h2 className="subtopics-heading">Table of Contents</h2>
                <ol className="toc-list">
                  {currentPage.subtopics.map((sub, i) => (
                    <li key={i} className="toc-item">
                      <button
                        className="toc-btn"
                        onClick={() => handleSubtopic(sub)}
                      >
                        <span className="toc-number">{i + 1}</span>
                        <span className="toc-label">
                          <span className="toc-label-text">{sub}</span>
                          <span className="toc-dots" aria-hidden="true" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
