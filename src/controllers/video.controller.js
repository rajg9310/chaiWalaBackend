import fs from "fs"
import mongoose, { isValidObjectId } from "mongoose"
import { Video } from "../models/video.model.js"
import { User } from "../models/user.model.js"
import { Comment } from "../models/comment.model.js"
import { Like } from "../models/like.model.js"
import { Playlist } from "../models/playlist.model.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js"

const getAllVideos = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, query, sortBy = "createdAt", sortType = "desc", userId } = req.query

    const pipeline = []

    if (query?.trim()) {
        pipeline.push({
            $match: {
                $or: [
                    { title: { $regex: query.trim(), $options: "i" } },
                    { description: { $regex: query.trim(), $options: "i" } }
                ]
            }
        })
    }

    if (userId) {
        if (!isValidObjectId(userId)) {
            throw new ApiError(400, "Invalid user ID")
        }
        pipeline.push({
            $match: {
                owner: new mongoose.Types.ObjectId(userId)
            }
        })
    }

    // Default to only showing published videos unless user is viewing their own
    if (req.user?._id) {
        pipeline.push({
            $match: {
                $or: [
                    { isPublished: true },
                    { owner: new mongoose.Types.ObjectId(req.user._id) }
                ]
            }
        })
    } else {
        pipeline.push({
            $match: {
                isPublished: true
            }
        })
    }

    const sortOrder = sortType?.toLowerCase() === "asc" ? 1 : -1
    const sortField = sortBy || "createdAt"

    pipeline.push({
        $sort: {
            [sortField]: sortOrder
        }
    })

    pipeline.push(
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "owner",
                pipeline: [
                    {
                        $project: {
                            username: 1,
                            fullName: 1,
                            avatar: 1
                        }
                    }
                ]
            }
        },
        {
            $addFields: {
                owner: { $first: "$owner" }
            }
        }
    )

    const videoAggregate = Video.aggregate(pipeline)
    const options = {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
    }

    const videos = await Video.aggregatePaginate(videoAggregate, options)

    return res
        .status(200)
        .json(new ApiResponse(200, videos, "Videos fetched successfully"))
})

const publishAVideo = asyncHandler(async (req, res) => {
    const { title, description } = req.body

    const videoFileLocalPath = req.files?.videoFile?.[0]?.path
    const thumbnailLocalPath = req.files?.thumbnail?.[0]?.path

    const cleanupLocalFiles = () => {
        if (videoFileLocalPath && fs.existsSync(videoFileLocalPath)) {
            fs.unlinkSync(videoFileLocalPath)
        }
        if (thumbnailLocalPath && fs.existsSync(thumbnailLocalPath)) {
            fs.unlinkSync(thumbnailLocalPath)
        }
    }

    if (!title || !title.trim()) {
        cleanupLocalFiles()
        throw new ApiError(400, "Title is required")
    }

    if (!description || !description.trim()) {
        cleanupLocalFiles()
        throw new ApiError(400, "Description is required")
    }

    if (!videoFileLocalPath) {
        cleanupLocalFiles()
        throw new ApiError(400, "Video file is required")
    }

    if (!thumbnailLocalPath) {
        cleanupLocalFiles()
        throw new ApiError(400, "Thumbnail is required")
    }

    const videoFile = await uploadOnCloudinary(videoFileLocalPath)
    const thumbnail = await uploadOnCloudinary(thumbnailLocalPath)

    if (!videoFile?.url) {
        cleanupLocalFiles()
        throw new ApiError(500, "Failed to upload video file to Cloudinary")
    }

    if (!thumbnail?.url) {
        cleanupLocalFiles()
        throw new ApiError(500, "Failed to upload thumbnail to Cloudinary")
    }

    const video = await Video.create({
        title: title.trim(),
        description: description.trim(),
        videoFile: videoFile.url,
        thumbnail: thumbnail.url,
        duration: videoFile.duration || 0,
        owner: req.user?._id,
        isPublished: true
    })

    if (!video) {
        throw new ApiError(500, "Failed to publish video")
    }

    return res
        .status(201)
        .json(new ApiResponse(201, video, "Video published successfully"))
})

const getVideoById = asyncHandler(async (req, res) => {
    const { videoId } = req.params

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video ID")
    }

    // Increment video views
    await Video.findByIdAndUpdate(videoId, {
        $inc: { views: 1 }
    })

    const videoAggregate = await Video.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(videoId)
            }
        },
        {
            $lookup: {
                from: "likes",
                localField: "_id",
                foreignField: "video",
                as: "likes"
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "owner",
                pipeline: [
                    {
                        $lookup: {
                            from: "subscriptions",
                            localField: "_id",
                            foreignField: "channel",
                            as: "subscribers"
                        }
                    },
                    {
                        $addFields: {
                            subscribersCount: { $size: "$subscribers" },
                            isSubscribed: {
                                $cond: {
                                    if: { $in: [req.user?._id, "$subscribers.subscriber"] },
                                    then: true,
                                    else: false
                                }
                            }
                        }
                    },
                    {
                        $project: {
                            username: 1,
                            fullName: 1,
                            avatar: 1,
                            subscribersCount: 1,
                            isSubscribed: 1
                        }
                    }
                ]
            }
        },
        {
            $addFields: {
                likesCount: { $size: "$likes" },
                owner: { $first: "$owner" },
                isLiked: {
                    $cond: {
                        if: { $in: [req.user?._id, "$likes.likedBy"] },
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project: {
                likes: 0
            }
        }
    ])

    if (!videoAggregate || videoAggregate.length === 0) {
        throw new ApiError(404, "Video not found")
    }

    return res
        .status(200)
        .json(new ApiResponse(200, videoAggregate[0], "Video fetched successfully"))
})

const updateVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params
    const { title, description } = req.body
    const thumbnailLocalPath = req.file?.path

    if (!isValidObjectId(videoId)) {
        if (thumbnailLocalPath && fs.existsSync(thumbnailLocalPath)) {
            fs.unlinkSync(thumbnailLocalPath)
        }
        throw new ApiError(400, "Invalid video ID")
    }

    const video = await Video.findById(videoId)
    if (!video) {
        if (thumbnailLocalPath && fs.existsSync(thumbnailLocalPath)) {
            fs.unlinkSync(thumbnailLocalPath)
        }
        throw new ApiError(404, "Video not found")
    }

    if (video.owner.toString() !== req.user?._id.toString()) {
        if (thumbnailLocalPath && fs.existsSync(thumbnailLocalPath)) {
            fs.unlinkSync(thumbnailLocalPath)
        }
        throw new ApiError(403, "You are not authorized to update this video")
    }

    if (thumbnailLocalPath) {
        const thumbnail = await uploadOnCloudinary(thumbnailLocalPath)
        if (!thumbnail?.url) {
            throw new ApiError(500, "Failed to upload thumbnail to Cloudinary")
        }
        if (video.thumbnail) {
            await deleteFromCloudinary(video.thumbnail, "image")
        }
        video.thumbnail = thumbnail.url
    }

    if (title?.trim()) {
        video.title = title.trim()
    }

    if (description?.trim()) {
        video.description = description.trim()
    }

    await video.save({ validateBeforeSave: false })

    return res
        .status(200)
        .json(new ApiResponse(200, video, "Video updated successfully"))
})

const deleteVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video ID")
    }

    const video = await Video.findById(videoId)
    if (!video) {
        throw new ApiError(404, "Video not found")
    }

    if (video.owner.toString() !== req.user?._id.toString()) {
        throw new ApiError(403, "You are not authorized to delete this video")
    }

    // Delete assets from Cloudinary
    if (video.videoFile) {
        await deleteFromCloudinary(video.videoFile, "video")
    }
    if (video.thumbnail) {
        await deleteFromCloudinary(video.thumbnail, "image")
    }

    // Delete video and related entities
    await Video.findByIdAndDelete(videoId)
    await Comment.deleteMany({ video: videoId })
    await Like.deleteMany({ video: videoId })
    await Playlist.updateMany({ videos: videoId }, { $pull: { videos: videoId } })

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Video deleted successfully"))
})

const togglePublishStatus = asyncHandler(async (req, res) => {
    const { videoId } = req.params

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video ID")
    }

    const video = await Video.findById(videoId)
    if (!video) {
        throw new ApiError(404, "Video not found")
    }

    if (video.owner.toString() !== req.user?._id.toString()) {
        throw new ApiError(403, "You are not authorized to toggle publish status for this video")
    }

    video.isPublished = !video.isPublished
    await video.save({ validateBeforeSave: false })

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                video,
                `Video ${video.isPublished ? "published" : "unpublished"} successfully`
            )
        )
})

export {
    getAllVideos,
    publishAVideo,
    getVideoById,
    updateVideo,
    deleteVideo,
    togglePublishStatus
}