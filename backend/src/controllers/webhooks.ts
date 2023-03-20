import { GetObjectCommand } from '@aws-sdk/client-s3'
import { type RequestHandler } from 'express'
import fetch from 'isomorphic-unfetch'
import { s3 } from '../lib/aws'
import prisma from '../lib/prisma'
import io from '../lib/socket'

export const ses: RequestHandler = async (req, res) => {
  const body = JSON.parse(req.body)

  if (body.Type === 'SubscriptionConfirmation') {
    await fetch(body.SubscribeURL)
  }

  if (body.Type === 'Notification') {
    const message = JSON.parse(body.Message)
    const { receipt } = message

    const params = {
      Bucket: receipt.action.bucketName,
      Key: receipt.action.objectKey
    }

    const data = await s3.send(new GetObjectCommand(params))
    const result = (await data.Body?.transformToString()) ?? ''

    // extract the thread ID (based on recipient email address, e.g. if the email was sent to 99@example.com, then thread ID is 99)
    const threadIdRegex = /(\d+)@connecto.johnmroyal\.com/
    const threadIdMatch = result.match(threadIdRegex)
    const threadId = threadIdMatch ? parseInt(threadIdMatch[1], 10) : null

    // retrieve the user (based on sender email address)
    const senderEmailRegex = /From: .*?<(.+?)>/
    const senderEmailMatch = result.match(senderEmailRegex)
    const senderEmail = senderEmailMatch ? senderEmailMatch[1] : null
    const user = await prisma.user.findUnique({ where: { email: senderEmail } })

    // retrieve message content
    const messageContentRegex =
      /Content-Type: text\/plain;[\s\S]*?\n\n([\s\S]*?)\n\n--/
    const messageContentMatch = result.match(messageContentRegex)
    const messageContent = messageContentMatch
      ? messageContentMatch[1].trim()
      : null

    // create the message
    const newMessage = await prisma.message.create({
      data: {
        content: messageContent,
        thread: { connect: { id: threadId } },
        user: { connect: { id: user?.id } }
      },
      include: { user: true }
    })
    console.log(newMessage)
  }

  res.status(200).send({ success: true })
}

export const textbelt: RequestHandler = async (req, res) => {
  const { threadId, userId } = req.query
  const { text: content } = req.body

  const message = await prisma.message.create({
    data: {
      content,
      thread: { connect: { id: Number(threadId) } },
      user: { connect: { id: Number(userId) } }
    },
    include: { user: true }
  })
  io.to(threadId as string).emit('message', message)
  res.status(201).send({ success: true })
}
