# Downtown Teknik - R8 / ProGuard Kurallari

# Flutter & Native MethodChannel
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-keep class com.avmtech.avm_tech_platform.** { *; }

# Shorebird Code Push
-keep class dev.shorebird.** { *; }

# Firebase Messaging & Local Notifications
-keep class com.google.firebase.** { *; }
-keep class com.dexterous.flutterlocalnotifications.** { *; }
-keepattributes *Annotation*
-keepclassmembers class * {
    @androidx.annotation.Keep <fields>;
    @androidx.annotation.Keep <methods>;
}

# Gson / Reflection tabanli bildirim serilestirme
-keep class com.google.gson.** { *; }
-keepattributes Signature
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn com.google.android.play.core.**
