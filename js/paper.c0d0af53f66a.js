(() => {
  'use strict'

  const root = document.documentElement
  const themeKey = 'paper:theme:v1'
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

  let sessionLikeClientId
  function getLikeClientId() {
    if (sessionLikeClientId) return sessionLikeClientId
    const saved = storage.get(likeClientKey)
    if (saved) return (sessionLikeClientId = saved)

    const generated = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    storage.set(likeClientKey, generated)
    return (sessionLikeClientId = generated)
  }

  async function requestLike(endpoint, postKey, options = {}) {
    const method = options.method || 'GET'
    const target = new URL(endpoint, window.location.href)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5000)

    if (method === 'GET') {
      target.searchParams.set('path', postKey)
      target.searchParams.set('clientId', getLikeClientId())
    }

    try {
      const response = await window.fetch(target, {
        method,
        cache: 'no-store',
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
      return await response.json()
    } finally {
      window.clearTimeout(timeout)
    }
  }

  function setupLocalLike() {
    document.querySelectorAll('.local-like__button').forEach(button => {
      const postKey = button.dataset.postKey || window.location.pathname
      const endpoint = button.dataset.likeEndpoint?.trim()
      const icon = button.querySelector('.local-like__icon')
      const countNode = button.querySelector('.local-like__count')
      const label = button.querySelector('.local-like__label')
      let liked = false
      let count = null
      let pending = false
      let syncError = false
      let ready = false
      const render = () => {
        const total = count === null ? '—' : numberFormat.format(count)
        const action = liked ? '取消点赞' : '点赞'
        const message = syncError ? '点赞服务暂不可用，点击重试' : pending ? '正在同步点赞' : `共 ${total} 个赞，点击${action}`
        button.disabled = pending || !endpoint
        button.classList.toggle('is-liked', liked)
        button.classList.toggle('is-pending', pending)
        button.setAttribute('aria-pressed', String(liked))
        button.setAttribute('aria-busy', String(pending))
        button.dataset.syncState = syncError ? 'error' : pending ? 'pending' : 'ready'
        button.setAttribute('aria-label', message)
        button.setAttribute('title', message)
        if (icon) icon.textContent = liked ? '♥' : '♡'
        if (countNode) countNode.textContent = syncError ? '重试' : total
        if (label) label.textContent = message
      }
      const sync = async (action) => {
        pending = true
        syncError = false
        render()
        try {
          const payload = await requestLike(endpoint, postKey, action ? { method: 'POST', action } : {})
          if (!Number.isSafeInteger(payload.likes) || payload.likes < 0 || typeof payload.liked !== 'boolean') throw new Error('Invalid response')
          count = payload.likes
          liked = payload.liked
          ready = true
        } catch (_) {
          // A timed-out write may have succeeded. Re-read before allowing another toggle.
          ready = false
          syncError = true
        } finally {
          pending = false
          render()
        }
      }
      button.addEventListener('click', () => {
        if (!pending && endpoint) sync(ready ? (liked ? 'unlike' : 'like') : undefined)
      })
      if (endpoint) sync()
      else { syncError = true; render() }
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
