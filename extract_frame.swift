#!/usr/bin/env swift
import Foundation
import AVFoundation
import ImageIO
import CoreGraphics
import CoreImage
import UniformTypeIdentifiers

guard CommandLine.arguments.count >= 3 else {
  exit(1)
}
let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

let asset = AVURLAsset(url: inputURL)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceAfter = .zero
generator.requestedTimeToleranceBefore = .zero

var actualTime: CMTime = .zero
guard let cgImage = try? generator.copyCGImage(at: .zero, actualTime: &actualTime) else {
  exit(2)
}

let width = cgImage.width
let height = cgImage.height
guard width > 0, height > 0 else { exit(3) }

// 使用系统 sRGB 色彩空间重绘，与「照片」/QuickTime 显示管线一致，实现零色差
guard let srgb = CGColorSpace(name: CGColorSpace.sRGB) else { exit(4) }
guard let context = CGContext(
  data: nil,
  width: width,
  height: height,
  bitsPerComponent: 8,
  bytesPerRow: 0,
  space: srgb,
  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else { exit(5) }

// 不翻转：AVAssetImageGenerator 在 appliesPreferredTrackTransform 下已返回正确朝向，再翻转会倒置
context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
guard let srgbImage = context.makeImage() else { exit(6) }

let dest = CGImageDestinationCreateWithURL(outputURL as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, srgbImage, [kCGImageDestinationEmbedThumbnail: false] as CFDictionary)
guard CGImageDestinationFinalize(dest) else { exit(7) }

exit(0)
