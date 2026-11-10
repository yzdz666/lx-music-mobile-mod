// import { createStyle } from '@/utils/tools'
import { useImperativeHandle, forwardRef, useState, useMemo } from 'react'
import { Modal, Pressable, StyleSheet, View, type ModalProps as _ModalProps } from 'react-native'
import { useStatusbarHeight } from '@/store/common/hook'
// import { useWindowSize } from '@/utils/hooks'

// const styles = createStyle({
//   container: {
//     flex: 1,
//   },
//   // mask: {
//   //   position: 'absolute',
//   //   top: 0,
//   //   left: 0,
//   //   bottom: 0,
//   //   right: 0,
//   //   // width: '100%',
//   //   // height: '100%',
//   // },
// })

export interface ModalProps extends Omit<_ModalProps, 'visible'> {
  onHide?: () => void
  /**
   * 按返回键是否隐藏
   */
  keyHide?: boolean
  /**
   * 点击背景是否隐藏
   */
  bgHide?: boolean
  /**
   * 背景颜色
   */
  bgColor?: string
  /**
   * 是否填充状态栏
   */
  statusBarPadding?: boolean
}


export interface ModalType {
  setVisible: (visible: boolean) => void
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  mask: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    flex: 1,
  },
})

export default forwardRef<ModalType, ModalProps>(({
  onHide = () => {},
  keyHide = true,
  bgHide = true,
  bgColor = 'rgba(0,0,0,0)',
  statusBarPadding = true,
  children,
  ...props
}: ModalProps, ref) => {
  const [visible, setVisible] = useState(false)
  // const { window: windowSize } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const handleRequestClose = () => {
    if (keyHide) {
      setVisible(false)
      onHide()
    }
  }
  const handleBgClose = () => {
    if (bgHide) {
      setVisible(false)
      onHide()
    }
  }

  useImperativeHandle(ref, () => ({
    setVisible(_visible) {
      if (visible == _visible) return
      setVisible(_visible)
      if (!_visible) onHide()
    },
  }))

  const memoChildren = useMemo(() => children, [children])

  /**
   * 背景遮罩与内容层必须是「兄弟」而不是「父子」。
   *
   * 1.22.40 之前的写法是把整棵内容树放进 TouchableWithoutFeedback 里，
   * 为了阻止点内容时误触背景关闭，Dialog 又在内容容器上加了
   * onStartShouldSetResponder={() => true} —— 这一下把 JS 手势整个抢走，
   * 弹窗里的 ScrollView（听歌报告「一年 / 全部」、歌单选择等）就再也滚不动了。
   *
   * 现在遮罩是底层绝对定位的 Pressable，内容层 pointerEvents="box-none"：
   * 空白处点击会穿透到遮罩（照常关闭），内容控件自己消费触摸，
   * 没有任何父级 responder 与 ScrollView 抢手势。
   */
  return (
    <Modal
      animationType="fade"
      transparent={true}
      hardwareAccelerated={true}
      statusBarTranslucent={true}
      visible={visible}
      onRequestClose={handleRequestClose}
      {...props}
    >
      {/* <StatusBar /> */}
      <View style={styles.root}>
        <Pressable style={[styles.mask, { backgroundColor: bgColor }]} onPress={handleBgClose} />
        {/* 这一层只做布局容器：box-none 让空白处的触摸穿透到底层遮罩，
            子控件（ScrollView / 按钮 / 输入框）自己正常接收事件。
            statusBar padding 保持原行为（TouchableWithoutFeedback 会把 style
            合并到子 View 上，之前就是生效的），不能省。 */}
        <View
          style={[styles.content, { paddingTop: statusBarPadding ? statusBarHeight : 0 }]}
          pointerEvents="box-none"
        >
          {memoChildren}
        </View>
      </View>
    </Modal>
  )
})
