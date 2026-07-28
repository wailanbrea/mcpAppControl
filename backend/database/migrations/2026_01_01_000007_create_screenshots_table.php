<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('screenshots', function (Blueprint $table) {
            $table->id();
            $table->string('device_serial');
            $table->longText('image_data');
            $table->timestamp('timestamp');
            $table->timestamps();

            $table->index(['device_serial', 'timestamp']);
        });
    }

    public function down(): void {
        Schema::dropIfExists('screenshots');
    }
};
