import CoreGraphics
import Foundation
import ImageIO
import Vision

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(1)
}

guard CommandLine.arguments.count == 6 else {
    fail("Usage: tako-ocr.swift <image> <x> <y> <width> <height>")
}

let arguments = CommandLine.arguments
let imageUrl = URL(fileURLWithPath: arguments[1])
guard
    let x = Double(arguments[2]),
    let y = Double(arguments[3]),
    let width = Double(arguments[4]),
    let height = Double(arguments[5]),
    let source = CGImageSourceCreateWithURL(imageUrl as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
    fail("Could not read the image or crop coordinates.")
}

let logicalWidth = 430.0
let logicalHeight = 932.0
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.minimumTextHeight = 0.012
request.regionOfInterest = CGRect(
    x: x / logicalWidth,
    y: 1.0 - ((y + height) / logicalHeight),
    width: width / logicalWidth,
    height: height / logicalHeight
)

do {
    try VNImageRequestHandler(cgImage: image, orientation: .up).perform([request])
} catch {
    fail("Vision OCR failed: \(error)")
}

let lines = (request.results ?? [])
    .sorted { left, right in
        if abs(left.boundingBox.maxY - right.boundingBox.maxY) > 0.01 {
            return left.boundingBox.maxY > right.boundingBox.maxY
        }
        return left.boundingBox.minX < right.boundingBox.minX
    }
    .compactMap { $0.topCandidates(1).first?.string }

guard
    let json = try? JSONSerialization.data(withJSONObject: lines),
    let output = String(data: json, encoding: .utf8)
else {
    fail("Could not encode OCR output.")
}

print(output)
