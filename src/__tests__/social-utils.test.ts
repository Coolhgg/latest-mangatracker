import { getNotifications, markNotificationsAsRead, getFollowers, getFollowing, checkFollowStatus, followUser, unfollowUser, getActivityFeed } from '@/lib/social-utils'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    notification: {
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    follow: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    activity: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
  },
}))

const { prisma } = require('@/lib/prisma')

describe('Social Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getNotifications', () => {
    it('should fetch notifications with pagination', async () => {
      const mockNotifications = [
        { id: '1', title: 'Test', type: 'new_chapter', read_at: null },
        { id: '2', title: 'Test 2', type: 'follow', read_at: new Date() },
      ]

      prisma.notification.findMany.mockResolvedValue(mockNotifications)
      prisma.notification.count.mockResolvedValue(2)

      const result = await getNotifications('user-1', { page: 1, limit: 20 })

      expect(result.items).toEqual(mockNotifications)
      expect(result.pagination.total).toBe(2)
      expect(result.pagination.page).toBe(1)
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: 'user-1' },
          orderBy: { created_at: 'desc' },
        })
      )
    })

    it('should filter by unread only', async () => {
      prisma.notification.findMany.mockResolvedValue([])
      prisma.notification.count.mockResolvedValue(0)

      await getNotifications('user-1', { unreadOnly: true })

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: 'user-1', read_at: null },
        })
      )
    })

    it('should filter by type', async () => {
      prisma.notification.findMany.mockResolvedValue([])
      prisma.notification.count.mockResolvedValue(0)

      await getNotifications('user-1', { type: 'new_chapter' })

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: 'user-1', type: 'new_chapter' },
        })
      )
    })
  })

  describe('markNotificationsAsRead', () => {
    it('should mark single notification as read', async () => {
      const mockUpdated = { id: '1', read_at: new Date() }
      prisma.notification.update.mockResolvedValue(mockUpdated)

      const result = await markNotificationsAsRead('user-1', 'notif-1')

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1', user_id: 'user-1' },
        data: { read_at: expect.any(Date) },
      })
      expect(result).toEqual(mockUpdated)
    })

    it('should mark all notifications as read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 })

      const result = await markNotificationsAsRead('user-1')

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1', read_at: null },
        data: { read_at: expect.any(Date) },
      })
    })
  })

  describe('checkFollowStatus', () => {
    it('should return true when following', async () => {
      prisma.follow.findUnique.mockResolvedValue({ id: '1' })

      const result = await checkFollowStatus('follower-1', 'following-1')

      expect(result).toBe(true)
    })

    it('should return false when not following', async () => {
      prisma.follow.findUnique.mockResolvedValue(null)

      const result = await checkFollowStatus('follower-1', 'following-1')

      expect(result).toBe(false)
    })
  })

  describe('followUser', () => {
    it('should throw error when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(followUser('user-1', 'nonexistent')).rejects.toThrow('Target user not found')
    })

    it('should throw error when trying to follow self', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' })

      await expect(followUser('user-1', 'self')).rejects.toThrow('Cannot follow yourself')
    })

    it('should return existing follow if already following', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'target-1' })
      const existingFollow = { id: 'follow-1', follower_id: 'user-1', following_id: 'target-1' }
      prisma.follow.findUnique.mockResolvedValue(existingFollow)

      const result = await followUser('user-1', 'target')

      expect(result).toEqual(existingFollow)
      expect(prisma.follow.create).not.toHaveBeenCalled()
    })

    it('should create new follow relationship', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'target-1' })
      prisma.follow.findUnique.mockResolvedValue(null)
      const newFollow = { id: 'follow-1', follower_id: 'user-1', following_id: 'target-1' }
      prisma.follow.create.mockResolvedValue(newFollow)
      prisma.notification.create.mockResolvedValue({})
      prisma.activity.create.mockResolvedValue({})

      const result = await followUser('user-1', 'target')

      expect(prisma.follow.create).toHaveBeenCalled()
      expect(prisma.notification.create).toHaveBeenCalled()
      expect(result).toEqual(newFollow)
    })
  })

  describe('unfollowUser', () => {
    it('should throw error when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(unfollowUser('user-1', 'nonexistent')).rejects.toThrow('Target user not found')
    })

    it('should delete follow relationship', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'target-1' })
      prisma.follow.deleteMany.mockResolvedValue({ count: 1 })

      const result = await unfollowUser('user-1', 'target')

      expect(prisma.follow.deleteMany).toHaveBeenCalledWith({
        where: { follower_id: 'user-1', following_id: 'target-1' },
      })
    })
  })

  describe('getFollowers', () => {
    it('should throw error when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(getFollowers('nonexistent')).rejects.toThrow('User not found')
    })

    it('should return paginated followers', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', privacy_settings: {} })
      const mockFollowers = [
        { follower: { id: 'f1', username: 'user1' } },
        { follower: { id: 'f2', username: 'user2' } },
      ]
      prisma.follow.findMany.mockResolvedValue(mockFollowers)
      prisma.follow.count.mockResolvedValue(2)

      const result = await getFollowers('testuser')

      expect(result.items).toHaveLength(2)
      expect(result.pagination.total).toBe(2)
    })
  })

  describe('getActivityFeed', () => {
    it('should return empty feed when no following', async () => {
      prisma.follow.findMany.mockResolvedValue([])

      const result = await getActivityFeed('user-1', { type: 'following' })

      expect(result.items).toEqual([])
      expect(result.pagination.total).toBe(0)
    })

    it('should fetch global feed', async () => {
      const mockActivities = [{ id: '1', type: 'chapter_read' }]
      prisma.activity.findMany.mockResolvedValue(mockActivities)
      prisma.activity.count.mockResolvedValue(1)

      const result = await getActivityFeed(null, { type: 'global' })

      expect(result.items).toEqual(mockActivities)
    })
  })
})
