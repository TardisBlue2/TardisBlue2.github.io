(() => {
  'use strict'

  const root = document.documentElement
  const themeKey = 'paper:theme:v1'
  const likePrefix = 'paper:local-like:v1:'
  const likeCountPrefix = 'paper:local-like-count:v1:'
  const likeClientKey = 'paper:local-like-client:v1'
  const mobileSidebar = window.matchMedia('(max-width: 959px)')
  const numberFormat = new Intl.NumberFormat('zh-CN')

  const storage = {
    get(key) {
      try {
        return window.localStorage.getItem(key)
      } catch (_) {
        return null
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value)
        return true
      } catch (_) {
        return false
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(key)
        return true
      } catch (_) {
        return false
      }
    },
  }

  function setupFixedTheme() {
    const metaThemeColor = document.querySelector('meta[name="theme-color"]')
    root.dataset.theme = 'light'
    root.style.colorScheme = 'light'
    storage.remove(themeKey)
    if (metaThemeColor) metaThemeColor.setAttribute('content', '#ffffff')
  }

  function normalizeCount(value, fallback = 0) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return fallback
    return Math.floor(parsed)
  }

  function readRemoteCount(payload, fallback) {
    return normalizeCount(
      payload?.likes ?? payload?.count ?? payload?.data?.likes ?? payload?.data?.count,
      fallback,
    )
  }

  function getLikeClientId() {
    const saved = storage.get(likeClientKey)
    if (saved) return saved

    const generated = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    storage.set(likeClientKey, generated)
    return generated
  }

  async function requestLike(endpoint, postKey, options = {}) {
    const method = options.method || 'GET'
    const target = new URL(endpoint, window.location.href)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5000)

    if (method === 'GET') target.searchParams.set('path', postKey)

    try {
      const response = await window.fetch(target, {
        method,
        headers: method === 'POST'
          ? { Accept: 'application/json', 'Content-Type': 'application/json' }
          : { Accept: 'application/json' },
        body: method === 'POST'
          ? JSON.stringify({
              path: postKey,
              action: options.action,
              clientId: getLikeClientId(),
            })
          : undefined,
        signal: controller.signal,
      })

      if (!response.ok) throw new Error(`Like API returned ${response.status}`)
      return response.json()
    } finally {
      window.clearTimeout(timeout)
    }
  }

  function setupLocalLike() {
    document.querySelectorAll('.local-like__button').forEach(button => {
      const postKey = button.dataset.postKey || window.location.pathname
      const encodedPostKey = encodeURIComponent(postKey)
      const storageKey = `${likePrefix}${encodedPostKey}`
      const countStorageKey = `${likeCountPrefix}${encodedPostKey}`
      const endpoint = button.dataset.likeEndpoint?.trim()
      const icon = button.querySelector('.local-like__icon')
      const countNode = button.querySelector('.local-like__count')
      const label = button.querySelector('.local-like__label')
      let liked = storage.get(storageKey) === '1'
      let count = Math.max(normalizeCount(storage.get(countStorageKey)), liked ? 1 : 0)
      let pending = false
      let syncError = false
      let interacted = false

      const render = () => {
        const formattedCount = numberFormat.format(count)
        const actionLabel = liked ? '取消点赞' : '点赞'
        button.classList.toggle('is-liked', liked)
        button.classList.toggle('is-pending', pending)
        button.setAttribute('aria-pressed', String(liked))
        button.setAttribute('aria-busy', String(pending))
        button.dataset.syncState = syncError ? 'error' : pending ? 'pending' : 'ready'
        button.disabled = pending
        button.setAttribute(
          'aria-label',
          syncError ? `点赞同步失败，共 ${formattedCount} 个赞，请重试` : `共 ${formattedCount} 个赞，点击${actionLabel}`,
        )
        button.setAttribute('title', syncError ? '点赞同步失败，请重试' : `共 ${formattedCount} 个赞`)
        if (icon) icon.textContent = liked ? '♥' : '♡'
        if (countNode) countNode.textContent = formattedCount
        if (label) label.textContent = actionLabel
      }

      const persist = () => {
        storage.set(storageKey, liked ? '1' : '0')
        storage.set(countStorageKey, String(count))
      }

      button.addEventListener('click', async () => {
        if (pending) return
        interacted = true
        const previousLiked = liked
        const previousCount = count
        liked = !liked
        count = Math.max(0, count + (liked ? 1 : -1))
        syncError = false
        persist()
        render()

        if (!endpoint) return

        pending = true
        render()
        try {
          const payload = await requestLike(endpoint, postKey, {
            method: 'POST',
            action: liked ? 'like' : 'unlike',
          })
          count = readRemoteCount(payload, count)
          persist()
        } catch (_) {
          liked = previousLiked
          count = previousCount
          syncError = true
          persist()
        } finally {
          pending = false
          render()
        }
      })

      render()

      if (endpoint) {
        requestLike(endpoint, postKey)
          .then(payload => {
            if (interacted) return
            count = readRemoteCount(payload, count)
            storage.set(countStorageKey, String(count))
            render()
          })
          .catch(() => {})
      }
    })
  }

  function setupTableOfContents() {
    const article = document.querySelector('.article__content')
    const container = document.querySelector('.toc__content')
    const wrapper = document.querySelector('.tocbot')
    if (!article || !container || !wrapper) return

    const headings = Array.from(article.querySelectorAll('h1, h2, h3, h4'))
      .filter(heading => heading.textContent.trim())

    if (headings.length === 0) {
      wrapper.hidden = true
      return
    }

    const usedIds = new Set(Array.from(document.querySelectorAll('[id]'), node => node.id))
    const list = document.createElement('ul')
    list.className = 'toc__list'

    headings.forEach((heading, index) => {
      if (!heading.id) {
        let id = `section-${index + 1}`
        let duplicate = 1
        while (usedIds.has(id)) {
          duplicate += 1
          id = `section-${index + 1}-${duplicate}`
        }
        heading.id = id
        usedIds.add(id)
      }

      const item = document.createElement('li')
      item.className = `toc__item toc__item--level-${heading.tagName.slice(1)}`
      const link = document.createElement('a')
      link.href = `#${encodeURIComponent(heading.id)}`
      link.textContent = heading.textContent.trim()
      item.appendChild(link)
      list.appendChild(item)
    })

    container.replaceChildren(list)
  }

  function setupSidebar() {
    const sidebar = document.querySelector('#site-sidebar')
    const openButton = document.querySelector('.sidebar__button')
    const closeButton = document.querySelector('.sidebar__close')
    const backdrop = document.querySelector('.sidebar-backdrop')
    if (!sidebar || !openButton || !closeButton || !backdrop) return

    let open = false

    const render = (restoreFocus = false) => {
      const mobile = mobileSidebar.matches
      const visible = mobile && open
      sidebar.classList.toggle('is-open', visible)
      backdrop.classList.toggle('is-visible', visible)
      document.body.classList.toggle('sidebar-open', visible)
      openButton.setAttribute('aria-expanded', String(visible))
      openButton.querySelector('.sidebar__button-label').textContent = visible ? '关闭侧栏' : '打开侧栏'
      backdrop.tabIndex = visible ? 0 : -1
      sidebar.inert = mobile && !visible

      if (visible) {
        closeButton.focus({ preventScroll: true })
      } else if (restoreFocus && mobile) {
        openButton.focus({ preventScroll: true })
      }
    }

    const close = restoreFocus => {
      open = false
      render(restoreFocus)
    }

    openButton.addEventListener('click', () => {
      open = !open
      render(false)
    })
    closeButton.addEventListener('click', () => close(true))
    backdrop.addEventListener('click', () => close(true))
    sidebar.addEventListener('click', event => {
      if (event.target.closest('a') && mobileSidebar.matches) close(false)
    })
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && open) close(true)
    })

    const handleViewportChange = () => {
      if (!mobileSidebar.matches) open = false
      render(false)
    }
    if (typeof mobileSidebar.addEventListener === 'function') {
      mobileSidebar.addEventListener('change', handleViewportChange)
    } else if (typeof mobileSidebar.addListener === 'function') {
      mobileSidebar.addListener(handleViewportChange)
    }

    render(false)
  }

  function init() {
    setupFixedTheme()
    setupLocalLike()
    setupTableOfContents()
    setupSidebar()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
