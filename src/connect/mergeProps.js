import verifyPlainObject from '../utils/verifyPlainObject'

export function defaultMergeProps(stateProps, dispatchProps, ownProps) {
// 默认merge简单粗暴
  return { ...ownProps, ...stateProps, ...dispatchProps }
}

export function wrapMergePropsFunc(mergeProps) {
  return function initMergePropsProxy(
    dispatch, { displayName, pure, areMergedPropsEqual }
  ) {
    let hasRunOnce = false
// 缓存
    let mergedProps

    return function mergePropsProxy(stateProps, dispatchProps, ownProps) {
      const nextMergedProps = mergeProps(stateProps, dispatchProps, ownProps)

      if (hasRunOnce) {
// 对比
// 不纯就不做浅层引用比较了，直接返回新对象表示props变了
// 或者纯的并且浅比较发现变了，也返回新对象
// 纯的，并且props经浅比较发现没变的话，就返回之前缓存的，表示props没变
        if (!pure || !areMergedPropsEqual(nextMergedProps, mergedProps))
          mergedProps = nextMergedProps

      } else {
        hasRunOnce = true
// 第一次没得比，直接作为缓存值
        mergedProps = nextMergedProps

// 开发环境检查最终nextProps是不是纯对象，不是的话，警告
        if (process.env.NODE_ENV !== 'production')
          verifyPlainObject(mergedProps, displayName, 'mergeProps')
      }

      return mergedProps
    }
  }
}

export function whenMergePropsIsFunction(mergeProps) {
  return (typeof mergeProps === 'function')
    ? wrapMergePropsFunc(mergeProps)
    : undefined
}

export function whenMergePropsIsOmitted(mergeProps) {
  return (!mergeProps)
    ? () => defaultMergeProps
    : undefined
}

export default [
  whenMergePropsIsFunction,
  whenMergePropsIsOmitted
]
