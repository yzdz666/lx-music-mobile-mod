#!/usr/bin/env node
/**
 * 静态检查：所有会被 Navigation.push 推入的屏幕，是否都注册了自己的 componentId。
 *
 * 首页侧边栏用的是原生 DrawerLayoutAndroid，它在「导航到其它屏幕再返回」后会失效。
 * 修复逻辑依赖 componentIds 的变化（usePageVisible / componentDidAppear）来触发，
 * 因此每个被 push 的屏幕都必须调用 setComponentId，否则返回首页后抽屉会只剩遮罩。
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const navFile = path.join(root, 'src/navigation/navigation.ts')
const screenNamesFile = path.join(root, 'src/navigation/screenNames.ts')

// 去掉注释，避免匹配到被注释掉的 push
const stripComments = (code) => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

const nav = stripComments(fs.readFileSync(navFile, 'utf8'))
const screenNames = stripComments(fs.readFileSync(screenNamesFile, 'utf8'))

// screenNames.ts 里的常量值，例如 PLAY_DETAIL_SCREEN = 'lxmusic.PlayDetail'
const constMap = new Map()
for (const m of screenNames.matchAll(/([A-Z0-9_]+_SCREEN)\s*=\s*'([^']+)'/g)) {
  constMap.set(m[1], m[2])
}

const pushed = new Set()
for (const m of nav.matchAll(/Navigation\.push\([^,]+,\s*\{[\s\S]{0,400}?name:\s*([A-Z0-9_]+_SCREEN)/g)) {
  pushed.add(m[1])
}
// 统一走 pushFullScreen 的页面（1.19+）
for (const m of nav.matchAll(/pushFullScreen\([^,]+,\s*([A-Z0-9_]+_SCREEN)/g)) {
  pushed.add(m[1])
}

const SPECIAL_DIRS = { webdav: 'WebDAV' }
const pascal = (name) => {
  const key = name.toLowerCase()
  if (SPECIAL_DIRS[key]) return SPECIAL_DIRS[key]
  return key.split('_').filter(Boolean).map(s => s[0].toUpperCase() + s.slice(1)).join('')
}

let failed = 0
const rows = []
for (const screenConst of [...pushed].sort()) {
  const pascalName = pascal(screenConst.replace(/_SCREEN$/, ''))
  const file = path.join(root, 'src/screens', pascalName, 'index.tsx')
  const exists = fs.existsSync(file)
  const source = exists ? fs.readFileSync(file, 'utf8') : ''
  const registers = /setComponentId\(/.test(source)
  if (!registers) failed++
  rows.push({ screenConst, name: constMap.get(screenConst) || '-', pascalName, exists, registers })
}

console.log('被 Navigation.push 推入的屏幕：')
for (const row of rows) {
  console.log(
    `  ${row.registers ? 'ok  ' : 'FAIL'}  ${row.pascalName.padEnd(16)} ${String(row.name).padEnd(28)} setComponentId=${row.registers} file=${row.exists}`,
  )
}

// 抽屉本身必须监听首页的 appear 事件
// v1.22.33 起侧边栏改成自绘抽屉（不再用 DrawerLayoutAndroid），
// 原来那四条「必须调用原生抽屉 API」的断言已经过时，改为检查新实现的关键点。
const drawer = fs.readFileSync(path.join(root, 'src/components/common/DrawerLayoutFixed.tsx'), 'utf8')
const checks = {
  '抽屉用自绘 Animated 进度值': /new Animated\.Value\(0\)/.test(drawer),
  '遮罩与面板共用同一个进度值': /progress/.test(drawer) && !/opacity: new Animated\.Value/.test(drawer),
  '抽屉宽度由 calcDrawerWidth 计算': /calcDrawerWidth/.test(drawer),
  '抽屉宽度不依赖首次 onLayout': /calcDrawerWidth\(windowWidth/.test(drawer),
}
for (const [label, pass] of Object.entries(checks)) {
  if (!pass) failed++
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}`)
}

if (failed) {
  console.error(`\nSCREEN CHECKS FAILED: ${failed}`)
  process.exit(1)
}
console.log('\nSCREEN CHECKS PASSED')
