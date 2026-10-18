import { Button, Drawer, Surface, ThemeRoot } from "@jfrader/ui"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { MOBILE_LAYOUT_QUERY } from "../../../app/media-queries"
import { useMediaQuery } from "../../../hooks/use-media-query"
import { useSessions } from "../../session/hooks/session-queries"
import { HistoryContent } from "./history-content"
import { HistoryHeader } from "./history-header"
import styles from "./history-navigation.module.css"

export function HistoryNavigation({
  mobileOpen,
  onCloseMobile,
}: {
  mobileOpen: boolean
  onCloseMobile: () => void
}) {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [drawerPanel, setDrawerPanel] = useState<HTMLDivElement | null>(null)
  const mobileLayout = useMediaQuery(MOBILE_LAYOUT_QUERY)
  const allSessions = useSessions("")
  const pristineEmpty =
    !allSessions.isLoading && !allSessions.error && allSessions.data?.sessions.length === 0
  const desktopSize = collapsed && !mobileOpen ? "w-12 basis-12" : "w-80 basis-80"
  const mobileClass = mobileOpen
    ? "max-mobile:visible max-mobile:translate-x-0"
    : "max-mobile:invisible max-mobile:-translate-x-full"

  const className = `${desktopSize} ${mobileClass} relative z-5 h-full min-w-0 shrink-0 grow-0 overflow-hidden border-r border-(--theme-line-subtle-color) bg-(--theme-surface-navigation) transition-[width,flex-basis,transform,visibility] duration-180 ease-(--motion-easing-standard) max-mobile:fixed max-mobile:inset-y-0 max-mobile:left-0 max-mobile:z-21 max-mobile:h-svh max-mobile:w-full max-mobile:flex-none max-mobile:border-r-0 max-mobile:bg-(--theme-surface-navigation-solid)`
  const content = (
    <>
      <HistoryHeader
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={onCloseMobile}
        onToggle={() => setCollapsed((value) => !value)}
      />
      <HistoryContent
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={onCloseMobile}
        pristineEmpty={pristineEmpty}
      />
      {pristineEmpty || (collapsed && !mobileOpen) ? null : (
        <div
          className={`${styles.footer} absolute right-6 left-6 opacity-100 transition-opacity duration-100 ease-(--motion-easing-standard)`}
          aria-hidden={collapsed && !mobileOpen}
          inert={collapsed && !mobileOpen}
        >
          <Button
            variant="outline"
            sx={{ width: "100%", minHeight: "var(--control-touch-target)" }}
            className={styles.newSummaryButton}
            type="button"
            onClick={() => {
              onCloseMobile()
              void navigate({ to: "/", search: {} })
            }}
          >
            <img className="size-4" src="/assets/link.svg" alt="" />
            <span>New summary</span>
          </Button>
        </div>
      )}
    </>
  )

  if (!mobileLayout) {
    return (
      <aside className={className} aria-label="Summary history">
        <Surface sx={{ height: "100%", border: 0, borderRadius: 0 }}>{content}</Surface>
      </aside>
    )
  }

  return (
    <Drawer
      open={mobileOpen}
      onOpenChange={(open) => {
        if (!open) onCloseMobile()
      }}
      side="inline-start"
    >
      <Drawer.Content
        aria-label="Summary history"
        withDescription={false}
        onClose={(event) => {
          if (event.target === event.currentTarget) onCloseMobile()
        }}
      >
        <Drawer.Panel
          ref={setDrawerPanel}
          appearance="default"
          sx={{
            width: "100%",
            maxWidth: "100%",
            inlineSize: "100%",
            "@media (max-width: 40rem)": { inlineSize: "100%" },
            borderRadius: 0,
            position: "relative",
            padding: 0,
          }}
        >
          <ThemeRoot theme="dark" portalContainer={drawerPanel} sx={{ display: "contents" }}>
            {content}
          </ThemeRoot>
        </Drawer.Panel>
      </Drawer.Content>
    </Drawer>
  )
}
