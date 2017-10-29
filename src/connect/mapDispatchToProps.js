import { bindActionCreators } from 'redux'
import { wrapMapToPropsConstant, wrapMapToPropsFunc } from './wrapMapToProps'

export function whenMapDispatchToPropsIsFunction(mapDispatchToProps) {
  return (typeof mapDispatchToProps === 'function')
    ? wrapMapToPropsFunc(mapDispatchToProps, 'mapDispatchToProps')
    : undefined
}

export function whenMapDispatchToPropsIsMissing(mapDispatchToProps) {
  return (!mapDispatchToProps)
//Q connect()(MyComponent)默认情况，MyComponent的props身上的dispatch哪里来的？
// 就是这里挂上去的，没传mapDispatchToProps的话，默认把dispatch挂到props上
    ? wrapMapToPropsConstant(dispatch => ({ dispatch }))
    : undefined
}

// mapDispatchToProps支持对象形式
// an object whose values are action creators.
// http://redux.js.org/docs/api/bindActionCreators.html#parameters
// 直接传递给redux的bindActionCreators
export function whenMapDispatchToPropsIsObject(mapDispatchToProps) {
  return (mapDispatchToProps && typeof mapDispatchToProps === 'object')
    ? wrapMapToPropsConstant(dispatch => bindActionCreators(mapDispatchToProps, dispatch))
    : undefined
}

export default [
  whenMapDispatchToPropsIsFunction,
  whenMapDispatchToPropsIsMissing,
  whenMapDispatchToPropsIsObject
]
