import verifyPlainObject from '../utils/verifyPlainObject'

export function wrapMapToPropsConstant(getConstant) {
  return function initConstantSelector(dispatch, options) {
    const constant = getConstant(dispatch, options)

    function constantSelector() { return constant }
// 没传mapToProps，当然不依赖自身props
    constantSelector.dependsOnOwnProps = false 
// selector每次调用都返回一个常量，不会变化
    return constantSelector
  }
}

// dependsOnOwnProps is used by createMapToPropsProxy to determine whether to pass props as args
// to the mapToProps function being wrapped. It is also used by makePurePropsSelector to determine
// whether mapToProps needs to be invoked when props have changed.
// 
// A length of one signals that mapToProps does not depend on props from the parent component.
// A length of zero is assumed to mean mapToProps is getting args via arguments or ...args and
// therefore not reporting its length accurately..
export function getDependsOnOwnProps(mapToProps) {
// 有dependsOnOwnProps的话，看这个
// 没有的话，根据mapToProps的参数个数来猜测（mapToProps.length）
// 0参依赖，多参也依赖，1参不依赖
// P.S.纯不定参数，length也是0 比如function f(...args){}
//Q 什么原理？？
// 因为mapToProps API支持2个参数 (state, props) => stateProps
// 假定1参时不依赖props，例外情况是 (state, ...args) => stateProps 此时会误判
// 0参或多参不好判定，假定此时依赖props，比如纯不定参数
// 之所以要这么费劲的判断，不单是考虑调用时要不要传props，还决定props变化时要不要调用mapToProps（影响性能）
  return (mapToProps.dependsOnOwnProps !== null && mapToProps.dependsOnOwnProps !== undefined)
    ? Boolean(mapToProps.dependsOnOwnProps)
    : mapToProps.length !== 1
}

// Used by whenMapStateToPropsIsFunction and whenMapDispatchToPropsIsFunction,
// this function wraps mapToProps in a proxy function which does several things:
// 
//  * Detects whether the mapToProps function being called depends on props, which
//    is used by selectorFactory to decide if it should reinvoke on props changes.
//    
//  * On first call, handles mapToProps if returns another function, and treats that
//    new function as the true mapToProps for subsequent calls.
//    
//  * On first call, verifies the first result is a plain object, in order to warn
//    the developer that their mapToProps function is not returning a valid result.
//    
export function wrapMapToPropsFunc(mapToProps, methodName) {
// 把传入的mapToProps包一层proxy
// 3个作用：
// 1.猜测传入的mapToProps是否依赖props参数，性能相关
// 2.首次调用（initProxySelector）如果返回function的话，后续用这个function换掉之前的mapToProps
// 3.首次调用如果返回不是function也不是纯对象的话，警告mapToProps用法不对
  return function initProxySelector(dispatch, { displayName }) {
    const proxy = function mapToPropsProxy(stateOrDispatch, ownProps) {
      return proxy.dependsOnOwnProps
        ? proxy.mapToProps(stateOrDispatch, ownProps)
        : proxy.mapToProps(stateOrDispatch)
    }

    // allow detectFactoryAndVerify to get ownProps
// 第一次不猜，先拿到ownProps，否则可能会错过props change（connect里不依赖就不调用）
    proxy.dependsOnOwnProps = true

// 把被代理的mapToProps包起来
    proxy.mapToProps = function detectFactoryAndVerify(stateOrDispatch, ownProps) {
// 第二次先复原
      proxy.mapToProps = mapToProps
// 猜是否依赖props（这个props指的是传给Container的props，依赖的话，就给透传进入）
      proxy.dependsOnOwnProps = getDependsOnOwnProps(mapToProps)
// 猜完立即算一遍props
      let props = proxy(stateOrDispatch, ownProps)

//! 技巧 懒参数
// mapToProps支持返回function，再猜一次
// https://github.com/reactjs/react-redux/blob/master/docs/api.md#arguments 引用部分
// https://github.com/reactjs/react-redux/pull/279 相关讨论
// 支持返回function主要是为了支持组件实例级（默认是组件级）的细粒度mapToProps控制
// 这样就能针对不同组件实例，给不同的mapToProps，支持进一步提升性能
// 相当于把实际参数延后了，支持传入一个参数工厂作为参数，第一次把外部环境传递给工厂，工厂再根据环境造出实际参数
// 添了工厂这个环节，就把控制粒度细化了一层（组件级的细化到了组件实例级，外部环境即组件实例信息）
// 在外部也能做这种控制，2种方法：
// 1.每次mapToProps里面都要过一遍不必要的检查（把针对该组件各种实例的检查放到一起，作为公共mapToProps）
// 2.由mapToProps自己来做，第一次执行完后，自己把自己换掉。但如果有存在其它缓存的话，就换不掉了
// 第一种对性能不好：
// 1.只能取并集，所有无法区分组件实例是否依赖props，props change时，存在多余的mapToProps调用
// 2.mapToProps里有多余的分支逻辑，特定组件实例可能只用到某个分支的逻辑，或者完全没有用到
      if (typeof props === 'function') {
        proxy.mapToProps = props
        proxy.dependsOnOwnProps = getDependsOnOwnProps(props)
        props = proxy(stateOrDispatch, ownProps)
      }

// 开发环境检查props是不是纯对象，不是的话，警告mapToProps用法不对
      if (process.env.NODE_ENV !== 'production') 
        verifyPlainObject(props, displayName, methodName)

      return props
    }

    return proxy
  }
}
