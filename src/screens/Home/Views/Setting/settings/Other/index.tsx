import { memo } from 'react'

import Section from '../../components/Section'
import ResourceCache from './ResourceCache'
import MetaCache from './MetaCache'
import DislikeList from './DislikeList'
import Log from './Log'
import ListenTogether from './ListenTogether'
import ScanLocalMusic from './ScanLocalMusic'
import PlayReport from './PlayReport'
import DownloadManager from './DownloadManager'
import About from './About'
// import MaxCache from './MaxCache'
import { useI18n } from '@/lang'

export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('setting_other')}>
      <ResourceCache />
      <MetaCache />
      <DislikeList />
      <Log />
      <DownloadManager />
      <ListenTogether />
      <ScanLocalMusic />
      <PlayReport />
      <About />
      {/* <MaxCache /> */}
    </Section>
  )
})
