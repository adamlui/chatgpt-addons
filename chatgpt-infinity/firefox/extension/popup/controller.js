(async () => {

    // Import JS resources
    for (const resource of ['components/icons.js', 'lib/dom.js', 'lib/settings.js'])
        await import(chrome.runtime.getURL(resource))

    // Init ENV context
    const env = {
        site: /([^.]+)\.[^.]+$/.exec(new URL((await chrome.tabs.query(
            { active: true, currentWindow: true }))[0].url).hostname)?.[1],
        browser: { displaysEnglish: (await chrome.i18n.getAcceptLanguages())[0].startsWith('en') }
    }

    // Import APP data
    const { app } = await chrome.storage.local.get('app')
    icons.import({ app }) // for src's using app.urls.assetHost

    // Define FUNCTIONS

    function notify(msg, pos = 'bottom-right') {
        if (config.notifDisabled && !msg.includes(chrome.i18n.getMessage('menuLabel_modeNotifs'))) return
        sendMsgToActiveTab('notify', { msg, pos })
    }

    async function sendMsgToActiveTab(action, options) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
        return await chrome.tabs.sendMessage(activeTab.id, { action: action, options: { ...options }})
    }
    function siteAlert(title, msg) { sendMsgToActiveTab('alert', { title, msg }) }
    async function sitePrompt(msg, defaultVal) { return await sendMsgToActiveTab('prompt', { msg, defaultVal }) }

    const sync = {
        fade() {

            // Update toolbar icon
            chrome.action.setIcon({ path: Object.fromEntries(
                Object.keys(chrome.runtime.getManifest().icons).map(dimension =>
                    [dimension, `../icons/${ config.extensionDisabled ? 'faded/' : '' }icon${dimension}.png`]
            ))})

            // Update menu contents
            const extensionIsDisabled = !masterToggle.checked
            document.querySelectorAll('.logo, .menu-title, .menu-item').forEach((elem, idx) => {
                elem.style.transition = extensionIsDisabled ? '' : 'opacity 0.25s ease-in'
                setTimeout(() => elem.classList.toggle('disabled', extensionIsDisabled),
                    extensionIsDisabled ? 0 : idx *10) // fade-out abruptly, fade-in staggered
            })
        },

        configToUI(options) { return sendMsgToActiveTab('syncConfigToUI', options) }
    }

    function toTitleCase(str) {
        if (!str) return ''
        const words = str.toLowerCase().split(' ')
        for (let i = 0 ; i < words.length ; i++)
            words[i] = words[i][0].toUpperCase() + words[i].slice(1)
        return words.join(' ')
    }

    // Run MAIN routine

    // Init MASTER TOGGLE
    const masterToggle = document.querySelector('input')
    await settings.load('extensionDisabled')
    masterToggle.checked = !config.extensionDisabled
    masterToggle.onchange = () => {
        settings.save('extensionDisabled', !config.extensionDisabled)
        if (config.infinityMode) // always disable Infinity Mode on master toggle
            document.querySelector('.menu-area > .toggle-switch > input')?.click()
        Object.keys(sync).forEach(key => sync[key]({ updatedKey: 'extensionDisabled' })) // sync fade + storage to UI
        notify(`${chrome.i18n.getMessage('appName')} 🧩 ${chrome.i18n.getMessage(`state_${
            config.extensionDisabled ? 'off' : 'on' }`).toUpperCase()}`)
    }

    // Create CHILD menu entries on chatgpt.com
    if (env.site == 'chatgpt') {
        await settings.load(Object.keys(settings.controls))
        const re_all = new RegExp(`^(${chrome.i18n.getMessage('menuLabel_all')}|all|any|every)$`, 'i')

        // Create/insert child section
        const togglesDiv = dom.create.elem('div', { class: 'menu' })
        document.querySelector('.menu-header').insertAdjacentElement('afterend', togglesDiv)

        // Create/insert child entries
        Object.keys(settings.controls).forEach(key => {

            // Init elems
            const menuItemDiv = dom.create.elem('div', {
                class: 'menu-item menu-area', title: settings.controls[key].helptip || '' })
            const menuLabel = dom.create.elem('label', { class: 'menu-icon' })
            const menuLabelSpan = dom.create.elem('span')
            let menuInput, menuSlider
            menuLabelSpan.textContent = settings.controls[key].label
            if (settings.controls[key].type == 'toggle') {
                menuInput = dom.create.elem('input', { type: 'checkbox' })
                menuInput.checked = /disabled|hidden/i.test(key) ^ config[key]
                menuSlider = dom.create.elem('span', { class: 'slider' })
                menuLabel.append(menuInput, menuSlider)
                menuLabel.classList.add('toggle-switch')
            } else if (settings.controls[key].type == 'prompt') {
                menuLabel.innerText = settings.controls[key].symbol
                menuLabel.classList.add('menu-prompt')
                menuLabelSpan.innerText +=  `— ${settings.controls[key].status}`
            }

            // Assemble/append elems
            menuItemDiv.append(menuLabel, menuLabelSpan)
            togglesDiv.append(menuItemDiv)

            // Add listeners
            if (settings.controls[key].type == 'toggle') {
                menuItemDiv.onclick = () => menuInput.click()
                menuInput.onclick = menuSlider.onclick = event => // prevent double toggle
                    event.stopImmediatePropagation()
                menuInput.onchange = () => {
                    settings.save(key, !config[key]) ; sync.configToUI({ updatedKey: key })
                    notify(`${settings.controls[key].label} ${chrome.i18n.getMessage(`state_${
                        /disabled|hidden/i.test(key) != config[key] ? 'on' : 'off'}`).toUpperCase()}`)
                }
            } else menuItemDiv.onclick = async () => {
                if (key == 'replyLanguage') {
                    while (true) {
                        let replyLang = await (await sitePrompt(
                            `${chrome.i18n.getMessage('prompt_updateReplyLang')}:`, config.replyLanguage)).input
                        if (replyLang == null) break // user cancelled so do nothing
                        else if (!/\d/.test(replyLang)) { // valid reply language set
                            replyLang = ( // auto-case for menu/alert aesthetics
                                replyLang.length < 4 || replyLang.includes('-') ? replyLang.toUpperCase()
                                    : replyLang.charAt(0).toUpperCase() + replyLang.slice(1).toLowerCase() )
                            settings.save('replyLanguage', replyLang || (await chrome.i18n.getAcceptLanguages())[0])
                            siteAlert(chrome.i18n.getMessage('alert_replyLangUpdated') + '!',
                                `${chrome.i18n.getMessage('appName')} ${chrome.i18n.getMessage('alert_willReplyIn')} `
                                  + `${ replyLang || chrome.i18n.getMessage('alert_yourSysLang') }.`
                            )
                            break
                        }
                    }
                } else if (key == 'replyTopic') {
                    let replyTopic = await (await sitePrompt(chrome.i18n.getMessage('prompt_updateReplyTopic')
                        + ' (' + chrome.i18n.getMessage('prompt_orEnter') + ' \'ALL\'):', config.replyTopic)).input
                    if (replyTopic != null) { // user didn't cancel
                        replyTopic = toTitleCase(replyTopic.toString()) // for menu/alert aesthetics
                        settings.save('replyTopic',
                            !replyTopic || re_all.test(replyTopic) ? chrome.i18n.getMessage('menuLabel_all')
                                                                   : replyTopic)
                        siteAlert(`${chrome.i18n.getMessage('alert_replyTopicUpdated')}!`,
                            `${chrome.i18n.getMessage('appName')} ${chrome.i18n.getMessage('alert_willAnswer')} `
                                + ( !replyTopic || re_all.test(replyTopic) ?
                                         chrome.i18n.getMessage('alert_onAllTopics')
                                    : `${chrome.i18n.getMessage('alert_onTopicOf')} ${replyTopic}`
                                ) + '!'
                        )
                    }
                } else if (key == 'replyInterval') {
                    while (true) {
                        const replyInterval = await (await sitePrompt(
                            `${chrome.i18n.getMessage('prompt_updateReplyInt')}:`, config.replyInterval)).input
                        if (replyInterval == null) break // user cancelled so do nothing
                        else if (!isNaN(parseInt(replyInterval, 10)) && parseInt(replyInterval, 10) > 4) {
                            settings.save('replyInterval', parseInt(replyInterval, 10))
                            siteAlert(chrome.i18n.getMessage('alert_replyIntUpdated') + '!',
                                chrome.i18n.getMessage('appName') + ' ' + chrome.i18n.getMessage('alert_willReplyEvery')
                                + ' ' + replyInterval + ' ' + chrome.i18n.getMessage('unit_seconds') + '.')
                            break
                        }
                    }
                }
                sync.configToUI({ updatedKey: key }) ; close() // popup
            }
        })
    }

    // LOCALIZE labels
    let translationOccurred = false
    document.querySelectorAll('[data-locale]').forEach(elem => {
        const localeKeys = elem.dataset.locale.split(' '),
              translatedText = localeKeys.map(key => chrome.i18n.getMessage(key)).join(' ')
        if (translatedText != elem.innerText) {
            elem.innerText = translatedText ; translationOccurred = true
    }})
    if (translationOccurred) // update <html lang> attr
        document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0]

    sync.fade() // based on master toggle

    // Create/append FOOTER container
    const footer = dom.create.elem('footer') ; document.body.append(footer)

    // Create/append CHATGPT.JS footer logo
    const cjsSpan = dom.create.elem('span', { class: 'cjs-span',
        title: env.browser.displaysEnglish ? '' : `${chrome.i18n.getMessage('about_poweredBy')} chatgpt.js` })
    const cjsLogo = dom.create.elem('img', {
        src: `${app.urls.cjsAssetHost}/images/badges/powered-by-chatgpt.js.png?b2a1975` })
    cjsSpan.onclick = () => { open(app.urls.chatgptJS) ; close() }
    cjsSpan.append(cjsLogo) ; footer.append(cjsSpan)

    // Create/append ABOUT footer button
    const aboutSpan = dom.create.elem('span', {
        title: `${chrome.i18n.getMessage('menuLabel_about')} ${chrome.i18n.getMessage('appName')}`,
        class: 'menu-icon menu-area', style: 'right:30px ; padding-top: 2px' })
    const aboutIcon = icons.create('questionMark', { width: 15, height: 13, style: 'margin-bottom: 0.04rem' })
    aboutSpan.onclick = () => { chrome.runtime.sendMessage({ action: 'showAbout' }) ; close() }
    aboutSpan.append(aboutIcon) ; footer.append(aboutSpan)

    // Create/append RELATED EXTENSIONS footer button
    const moreExtensionsSpan = dom.create.elem('span', {
        title:  chrome.i18n.getMessage('btnLabel_moreAIextensions'),
        class: 'menu-icon menu-area', style: 'right:2px ; padding-top: 2px' })
    const moreExtensionsIcon = icons.create('plus')
    moreExtensionsSpan.onclick = () => { open(app.urls.relatedExtensions) ; close() }
    moreExtensionsSpan.append(moreExtensionsIcon) ; footer.append(moreExtensionsSpan)

    // Remove loading spinner
    document.querySelectorAll('[class^=loading]').forEach(elem => elem.remove())

})()
