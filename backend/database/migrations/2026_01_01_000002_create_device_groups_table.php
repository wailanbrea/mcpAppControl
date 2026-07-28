<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('device_groups', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->text('description')->nullable();
            $table->integer('max_devices')->nullable();
            $table->timestamp('paused_at')->nullable();
            $table->timestamps();

            $table->unique('name');
        });
    }

    public function down(): void {
        Schema::dropIfExists('device_groups');
    }
};
