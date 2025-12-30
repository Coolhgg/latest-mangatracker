import { renderHook, act, waitFor } from '@testing-library/react'
import { useDebounce, useThrottle, useLocalStorage, usePrevious, useOnlineStatus } from '@/hooks/use-performance'

describe('Performance Hooks', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('useDebounce', () => {
    it('should debounce value changes', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        { initialProps: { value: 'initial', delay: 500 } }
      )

      expect(result.current).toBe('initial')

      rerender({ value: 'updated', delay: 500 })
      expect(result.current).toBe('initial')

      act(() => {
        jest.advanceTimersByTime(500)
      })

      expect(result.current).toBe('updated')
    })

    it('should reset timer on rapid changes', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        { initialProps: { value: 'a', delay: 300 } }
      )

      rerender({ value: 'b', delay: 300 })
      act(() => {
        jest.advanceTimersByTime(100)
      })

      rerender({ value: 'c', delay: 300 })
      act(() => {
        jest.advanceTimersByTime(100)
      })

      expect(result.current).toBe('a')

      act(() => {
        jest.advanceTimersByTime(300)
      })

      expect(result.current).toBe('c')
    })
  })

  describe('useThrottle', () => {
    it('should throttle value changes', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useThrottle(value, delay),
        { initialProps: { value: 'initial', delay: 500 } }
      )

      expect(result.current).toBe('initial')

      rerender({ value: 'updated', delay: 500 })

      act(() => {
        jest.advanceTimersByTime(500)
      })

      expect(result.current).toBe('updated')
    })
  })

  describe('useLocalStorage', () => {
    beforeEach(() => {
      localStorage.clear()
    })

    it('should return initial value when localStorage is empty', () => {
      const { result } = renderHook(() => useLocalStorage('test-key', 'default'))

      expect(result.current[0]).toBe('default')
    })

    it('should persist value to localStorage', () => {
      const { result } = renderHook(() => useLocalStorage('test-key', 'initial'))

      act(() => {
        result.current[1]('new value')
      })

      expect(result.current[0]).toBe('new value')
      expect(localStorage.getItem('test-key')).toBe('"new value"')
    })

    it('should support functional updates', () => {
      const { result } = renderHook(() => useLocalStorage<number>('counter', 0))

      act(() => {
        result.current[1]((prev) => prev + 1)
      })

      expect(result.current[0]).toBe(1)
    })

    it('should handle objects', () => {
      const initialObj = { name: 'test', count: 0 }
      const { result } = renderHook(() => useLocalStorage('obj-key', initialObj))

      act(() => {
        result.current[1]({ name: 'updated', count: 5 })
      })

      expect(result.current[0]).toEqual({ name: 'updated', count: 5 })
    })
  })

  describe('usePrevious', () => {
    it('should return undefined initially', () => {
      const { result } = renderHook(() => usePrevious('initial'))

      expect(result.current).toBeUndefined()
    })

    it('should return previous value after update', () => {
      const { result, rerender } = renderHook(
        ({ value }) => usePrevious(value),
        { initialProps: { value: 'first' } }
      )

      expect(result.current).toBeUndefined()

      rerender({ value: 'second' })
      expect(result.current).toBe('first')

      rerender({ value: 'third' })
      expect(result.current).toBe('second')
    })
  })

  describe('useOnlineStatus', () => {
    it('should return true by default', () => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
        configurable: true,
      })

      const { result } = renderHook(() => useOnlineStatus())

      expect(result.current).toBe(true)
    })

    it('should update when offline event fires', () => {
      const { result } = renderHook(() => useOnlineStatus())

      act(() => {
        window.dispatchEvent(new Event('offline'))
      })

      expect(result.current).toBe(false)
    })

    it('should update when online event fires', () => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        writable: true,
        configurable: true,
      })

      const { result } = renderHook(() => useOnlineStatus())

      act(() => {
        window.dispatchEvent(new Event('online'))
      })

      expect(result.current).toBe(true)
    })
  })
})
