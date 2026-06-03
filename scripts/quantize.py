# scripts/quantize.py
import tensorflow as tf

# Load your downloaded MobileFaceNet model
converter = tf.lite.TFLiteConverter.from_saved_model('./mobilefacenet_saved_model')

# Apply INT8 Quantization
converter.optimizations = [tf.lite.Optimize.DEFAULT]
def representative_dataset():
    for _ in range(100):
        yield [tf.random.normal([1, 112, 112, 3])] # MobileFaceNet input shape

converter.representative_dataset = representative_dataset
converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
converter.inference_input_type = tf.int8
converter.inference_output_type = tf.int8

tflite_quant_model = converter.convert()
with open('../assets/models/mobilefacenet_int8.tflite', 'wb') as f:
    f.write(tflite_quant_model)
print("Model quantized to INT8 and saved!")
