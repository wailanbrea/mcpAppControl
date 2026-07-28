<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('devices', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('serial_number')->unique();
            $table->string('model');
            $table->string('android_version');
            $table->enum('status', ['online', 'offline', 'busy', 'error'])->default('offline');
            // Sin FK: device_groups y tasks se crean en migraciones posteriores
            $table->unsignedBigInteger('assigned_group_id')->nullable()->index();
            $table->unsignedBigInteger('current_task_id')->nullable()->index();
            $table->timestamp('last_seen')->nullable();
            $table->timestamps();

            $table->index(['status', 'assigned_group_id']);
            $table->index('serial_number');
        });
    }

    public function down(): void {
        Schema::dropIfExists('devices');
    }
};
