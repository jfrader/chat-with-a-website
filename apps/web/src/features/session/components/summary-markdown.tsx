import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import styles from "./summary-article.module.css"

export function SummaryMarkdown({ streaming, summary }: { streaming: boolean; summary: string }) {
  return (
    <div className={styles.summary} data-streaming={streaming || undefined}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ),
          img: ({ alt }) => <span>Image omitted{alt ? `: ${alt}` : ""}</span>,
        }}
      >
        {summary}
      </ReactMarkdown>
    </div>
  )
}
