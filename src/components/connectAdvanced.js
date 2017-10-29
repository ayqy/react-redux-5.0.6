import hoistStatics from 'hoist-non-react-statics'
import invariant from 'invariant'
import { Component, createElement } from 'react'

import Subscription from '../utils/Subscription'
import { storeShape, subscriptionShape } from '../utils/PropTypes'

let hotReloadingVersion = 0
const dummyState = {}
function noop() {}
//! 技巧 让纯函数拥有状态
// 把纯函数用对象包起来，就可以有局部状态了，作用和new Class Instance类似
function makeSelectorStateful(sourceSelector, store) {
  // wrap the selector in an object that tracks its results between runs.
  const selector = {
    run: function runComponentSelector(props) {
      try {
// sourceSelector执行出错的话，本次和下一次都强制更新，因为selector.props不可靠了
        const nextProps = sourceSelector(store.getState(), props)
        if (nextProps !== selector.props || selector.error) {
          selector.shouldComponentUpdate = true
          selector.props = nextProps
          selector.error = null
        }
      } catch (error) {
        selector.shouldComponentUpdate = true
        selector.error = error
      }
    }
  }

  return selector
}

export default function connectAdvanced(
  /*
    selectorFactory is a func that is responsible for returning the selector function used to
    compute new props from state, props, and dispatch. For example:

      export default connectAdvanced((dispatch, options) => (state, props) => ({
        thing: state.things[props.thingId],
        saveThing: fields => dispatch(actionCreators.saveThing(props.thingId, fields)),
      }))(YourComponent)

    Access to dispatch is provided to the factory so selectorFactories can bind actionCreators
    outside of their selector as an optimization. Options passed to connectAdvanced are passed to
    the selectorFactory, along with displayName and WrappedComponent, as the second argument.

    Note that selectorFactory is responsible for all caching/memoization of inbound and outbound
    props. Do not use connectAdvanced directly without memoizing results between calls to your
    selector, otherwise the Connect component will re-render on every state or props change.
  */
  selectorFactory,
  // options object:
  {
    // the func used to compute this HOC's displayName from the wrapped component's displayName.
    // probably overridden by wrapper functions such as connect()
    getDisplayName = name => `ConnectAdvanced(${name})`,

    // shown in error messages
    // probably overridden by wrapper functions such as connect()
    methodName = 'connectAdvanced',

    // if defined, the name of the property passed to the wrapped element indicating the number of
    // calls to render. useful for watching in react devtools for unnecessary re-renders.
// render调用次数
    renderCountProp = undefined,

    // determines whether this HOC subscribes to store changes
// 是否关注state change
// 如果是独立组件，不依赖state，可能不需要关注state change，比如注销按钮
    shouldHandleStateChanges = true,

    // the key of props/context to get the store
    storeKey = 'store',

    // if true, the wrapped element is exposed by this HOC via the getWrappedInstance() function.
// 允许通过getWrappedInstance()访问原组件实例
    withRef = false,

//! 技巧 不定参数
// 把剩余属性都包进connectOptions
// 例如
// function f({a = 'a', b = 'b', ...others} = {}) {
//     console.log(a, b, others)
// }
    // additional options are passed through to the selectorFactory
    ...connectOptions
//! 技巧 默认参数
// 防止解构赋值右边undefined
  } = {}
) {
  const subscriptionKey = storeKey + 'Subscription'
  const version = hotReloadingVersion++

  const contextTypes = {
    [storeKey]: storeShape,
    [subscriptionKey]: subscriptionShape,
  }
  const childContextTypes = {
    [subscriptionKey]: subscriptionShape,
  }

  return function wrapWithConnect(WrappedComponent) {
    invariant(
      typeof WrappedComponent == 'function',
      `You must pass a component to the function returned by ` +
      `connect. Instead received ${JSON.stringify(WrappedComponent)}`
    )

    const wrappedComponentName = WrappedComponent.displayName
      || WrappedComponent.name
      || 'Component'

    const displayName = getDisplayName(wrappedComponentName)

    const selectorFactoryOptions = {
// 展开 还原回去
      ...connectOptions,
      getDisplayName,
      methodName,
      renderCountProp,
      shouldHandleStateChanges,
      storeKey,
      withRef,
      displayName,
      wrappedComponentName,
      WrappedComponent
    }

    class Connect extends Component {
      constructor(props, context) {
        super(props, context)

        this.version = version
        this.state = {}
        this.renderCount = 0
        this.store = props[storeKey] || context[storeKey]
//Q props mode有什么特殊性？
// 可以不用Provider，按需connect，手动传递
// 有什么好处？？
// 避免干扰业务，保持store subscription的存在对业务组件透明
// 如果store是通过props传进来的，就把subscription挂context上，反之挂props上
        this.propsMode = Boolean(props[storeKey])
        this.setWrappedInstance = this.setWrappedInstance.bind(this)

        invariant(this.store,
          `Could not find "${storeKey}" in either the context or props of ` +
          `"${displayName}". Either wrap the root component in a <Provider>, ` +
          `or explicitly pass "${storeKey}" as a prop to "${displayName}".`
        )

// selector用来计算props，并内置缓存对比
        this.initSelector()
// 初始化state change监听
        this.initSubscription()
      }

      getChildContext() {
        // If this component received store from props, its subscription should be transparent
        // to any descendants receiving store+subscription from context; it passes along
        // subscription passed to it. Otherwise, it shadows the parent subscription, which allows
        // Connect to control ordering of notifications to flow top-down.
// 2种情况
// 如果store是props传进来的，就取context里的subscription，并向下传递
//     向下传递是为了找到parentSubscription，建立层级state change监听
// 如果store是挂在context上的，就把当前subscription向下传递
        const subscription = this.propsMode ? null : this.subscription
        return { [subscriptionKey]: subscription || this.context[subscriptionKey] }
      }

      componentDidMount() {
        if (!shouldHandleStateChanges) return

        // componentWillMount fires during server side rendering, but componentDidMount and
        // componentWillUnmount do not. Because of this, trySubscribe happens during ...didMount.
        // Otherwise, unsubscription would never take place during SSR, causing a memory leak.
        // To handle the case where a child component may have triggered a state change by
        // dispatching an action in its componentWillMount, we have to re-run the select and maybe
        // re-render.
// 本来应该在willMount里subscribe
// 但因为SSR不触发dodMount和willUnmount，没机会unsubscribe，会造成内存泄漏
// 所以延后subscribe到didMount
// 但这样的话，SSR不做subscribe，会不会有问题？
        this.subscription.trySubscribe()
// willMount里可能有dispatch，这里重新计算props
// 如果变了就强制更新子树
        this.selector.run(this.props)
        if (this.selector.shouldComponentUpdate) this.forceUpdate()
      }

      componentWillReceiveProps(nextProps) {
// 更新时重新计算props
        this.selector.run(nextProps)
      }

      shouldComponentUpdate() {
// 内置的shouldComponentUpdate
        return this.selector.shouldComponentUpdate
      }

      componentWillUnmount() {
// unsubscribe并清掉持有的所有状态
        if (this.subscription) this.subscription.tryUnsubscribe()
        this.subscription = null
//Q 这个哪里调用了，用原始的不行吗？
// Connect自身热更新的时候可能会走到这里，此时不希望向下通知旧的subscription
// 上面把subscription null掉了（GC需要，不然没机会null了），如果上方的通知正在执行，会调用到onStateChange
// 不换noop的话，会导致subscription.notifyNestedSubs报错
        this.notifyNestedSubs = noop
        this.store = null
        this.selector.run = noop
        this.selector.shouldComponentUpdate = false
      }

      getWrappedInstance() {
// 把原组件实例暴露出去
        invariant(withRef,
          `To access the wrapped instance, you need to specify ` +
          `{ withRef: true } in the options argument of the ${methodName}() call.`
        )
        return this.wrappedInstance
      }

// 函数ref
      setWrappedInstance(ref) {
        this.wrappedInstance = ref
      }

      initSelector() {
// selector用来计算props，内置细粒度props缓存比较
// (dispatch, {
//     initMapStateToProps, initMapDispatchToProps, initMergeProps, opts
// }) => (mapStateToProps, mapDispatchToProps, mergeProps, dispatch) => nextProps
        const sourceSelector = selectorFactory(this.store.dispatch, selectorFactoryOptions)
// 细粒度props缓存之上的props整体缓存，由此得出shouldComponentUpdate
        this.selector = makeSelectorStateful(sourceSelector, this.store)
// 计算初始props
        this.selector.run(this.props)
      }

      initSubscription() {
        // 组件不关注state change的话，不订阅store变化
        if (!shouldHandleStateChanges) return

        // parentSub's source should match where store came from: props vs. context. A component
        // connected to the store via props shouldn't use subscription from context, or vice versa.
// subscription挂的位置不同，在props上还是在context上
        const parentSub = (this.propsMode ? this.props : this.context)[subscriptionKey]
        this.subscription = new Subscription(this.store, parentSub, this.onStateChange.bind(this))

        // `notifyNestedSubs` is duplicated to handle the case where the component is  unmounted in
        // the middle of the notification loop, where `this.subscription` will then be null. An
        // extra null check every change can be avoided by copying the method onto `this` and then
        // replacing it with a no-op on unmount. This can probably be avoided if Subscription's
        // listeners logic is changed to not call listeners that have been unsubscribed in the
        // middle of the notification loop.
// 这里记一份是为了应对一次通知过程中，listener被中途干掉的情况
//Q 没有别的办法吗？这一份完全是重复的
// 这种做法还算合理，因为与组件生命周期有关（卸载时要删除通知子级），挂在组件身上不算过分
        this.notifyNestedSubs = this.subscription.notifyNestedSubs.bind(this.subscription)
      }

      onStateChange() {
// state change时重新计算props
        this.selector.run(this.props)

// 当前组件不用更新的话，通知下方container检查更新
// 要更新的话，setState空对象强制更新，延后通知到didUpdate
        if (!this.selector.shouldComponentUpdate) {
          this.notifyNestedSubs()
        } else {
// 动态修改生命周期函数
          this.componentDidUpdate = this.notifyNestedSubsOnComponentDidUpdate
// 通知Container下方的view更新
//!!! 这里是把redux与react连接起来的关键
// 1.dispatch action
// 2.redux计算reducer得到newState
// 3.redux触发state change（调用之前通过store.subscribe注册的state变化监听器）
// 4.react-redux顶层Container的onStateChange触发
//   1.重新计算props
//   2.比较新值和缓存值，看props变了没，要不要更新
//   3.要的话通过setState({})强制react更新
//   4.通知下方的subscription，触发下方关注state change的Container的onStateChange，检查是否需要更新view
//Q 对于多级Container，走两遍的情况确实存在
//  上层Container在didUpdate后会通知下方Container检查更新，可能会在小子树再走一遍
//  但在大子树更新的过程中，走到下方Container时，小子树在这个时机就开始更新了
//  大子树didUpdate后的通知只会让下方Container空走一遍检查，不会有实际更新
//  检查的具体成本是调用sourceSelector计算props
//  然后sourceSelector分别对state和props做===比较和浅层引用比较（也是先===比较）
//  没变就结束了
//  所以每个下层Container的性能成本是两个===比较，不要紧
          this.setState(dummyState)
        }
      }

      notifyNestedSubsOnComponentDidUpdate() {
        // `componentDidUpdate` is conditionally implemented when `onStateChange` determines it
        // needs to notify nested subs. Once called, it unimplements itself until further state
        // changes occur. Doing it this way vs having a permanent `componentDidUpdate` that does
        // a boolean check every time avoids an extra method call most of the time, resulting
        // in some perf boost.
// 重置回来，执行被延后的通知
        this.componentDidUpdate = undefined
        this.notifyNestedSubs()
      }

      isSubscribed() {
// 把监听状态暴露出去
// 有2种情况是false
// 1.组件不关心state change
// 2.被unsubscribe了
        return Boolean(this.subscription) && this.subscription.isSubscribed()
      }

      addExtraProps(props) {
        if (!withRef && !renderCountProp && !(this.propsMode && this.subscription)) return props
        // make a shallow copy so that fields added don't leak to the original selector.
        // this is especially important for 'ref' since that's a reference back to the component
        // instance. a singleton memoized selector would then be holding a reference to the
        // instance, preventing the instance from being garbage collected, and that would be bad
//! 技巧 浅拷贝保证最少知识
//! 浅拷贝props，不把别人不需要的东西传递出去，否则影响GC
        const withExtras = { ...props }
// 挂上函数ref
        if (withRef) withExtras.ref = this.setWrappedInstance
// render
        if (renderCountProp) withExtras[renderCountProp] = this.renderCount++
// 如果store是props传进来，把subscription挂到props上，传递下去
// 否则应该在context上(getChildContext())，这里不用处理
        if (this.propsMode && this.subscription) withExtras[subscriptionKey] = this.subscription
        return withExtras
      }

      render() {
        const selector = this.selector
// 每次render重置should
        selector.shouldComponentUpdate = false

// props计算出错的话，直接throw
// 否则render原组件
        if (selector.error) {
          throw selector.error
        } else {
          return createElement(WrappedComponent, this.addExtraProps(selector.props))
        }
      }
    }

    Connect.WrappedComponent = WrappedComponent
    Connect.displayName = displayName
    Connect.childContextTypes = childContextTypes
// 声明types，想要store和subscription
// 开发环境console.error(warning)，生产环境不检查
    Connect.contextTypes = contextTypes
    Connect.propTypes = contextTypes

    if (process.env.NODE_ENV !== 'production') {
// 开发环境，支持hotReloading
// Connect自身更新的话，重新注册listeners
      Connect.prototype.componentWillUpdate = function componentWillUpdate() {
        // We are hot reloading!
        if (this.version !== version) {
          this.version = version
          this.initSelector()

          // If any connected descendants don't hot reload (and resubscribe in the process), their
          // listeners will be lost when we unsubscribe. Unfortunately, by copying over all
          // listeners, this does mean that the old versions of connected descendants will still be
          // notified of state changes; however, their onStateChange function is a no-op so this
          // isn't a huge deal.
          let oldListeners = [];

          if (this.subscription) {
            oldListeners = this.subscription.listeners.get()
            this.subscription.tryUnsubscribe()
          }
          this.initSubscription()
          if (shouldHandleStateChanges) {
            this.subscription.trySubscribe()
// 看着不太合理，深入Subscription调用底层方法
// 但仅用于开发环境，这样保证了Subscription身上没有多余接口
            oldListeners.forEach(listener => this.subscription.listeners.subscribe(listener))
          }
        }
      }
    }

//Q 用来干嘛的？
// 把原组件身上的非React组件静态属性粘到Connect身上
    return hoistStatics(Connect, WrappedComponent)
  }
}
