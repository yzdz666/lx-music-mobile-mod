import { memo, useState } from 'react'

import Section from '../../components/Section'
import IsEnable from './IsEnable'
import History from './History'
import WebDAV from './WebDAV'
import CloudSync from './CloudSync'
import { useI18n } from '@/lang'
// import SyncHost from './SyncHost'

export default memo(() => {
  const t = useI18n()

  const [host, setHost] = useState('')

  return (
    <Section title={t('setting_sync')}>
      <IsEnable host={host} setHost={setHost} />
      <History setHost={setHost} />
      <CloudSync />
      <WebDAV />
    </Section>
  )
})
